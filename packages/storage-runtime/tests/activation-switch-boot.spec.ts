import { IDBKeyRange as FakeIDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { createInitialDemoData } from "@revival/database";
import {
  ActivationJournalRepository,
  IndexedDbAdapter,
  MIGRATION_EXECUTION_STORE_ORDER,
  computeStoreChecksum,
  deleteIndexedDbDatabase,
  metadataId,
  type MigrationExecutionMetadataRecord,
  type MigrationLockAcquireOptions,
  type MigrationLockHandle,
  type MigrationLockProvider,
  type StorageEntityName
} from "@revival/storage-service";
import {
  ActivationBootCoordinator,
  ActivationRecoveryCoordinator,
  ActivationSwitcher,
  IndexedDbRuntime,
  STORAGE_BOOTSTRAP_MARKER_KEY,
  StorageBootstrapMarkerStore,
  StorageRuntimeBroadcast,
  StorageWriteGate,
  computeRuntimeBundleChecksum,
  createSafeActivationRecoveryReport,
  dehydrateRuntimeState,
  selectStorageRuntime,
  type ActivationConfirmationValues,
  type ActivationPreflightResult,
  type BootstrapMarkerStorageLike,
  type BroadcastChannelLike,
  type StorageBootstrapMarkerV1
} from "../src";
import { TestHarness } from "./test-harness";

const NOW = "2026-07-19T08:00:00.000Z";
const CONFIRMATIONS: ActivationConfirmationValues = {
  indexedDbOnlyWrites: true,
  legacyRetainedReadOnly: true,
  noDirectMigrationRollback: true,
  recoveryOnBootFailure: true
};
let databaseCounter = 0;

export function registerActivationSwitchBootTests(harness: TestHarness): void {
  harness.test("Runtime selector chooses strict legacy, prepared, activation boot, active and recovery modes", () => {
    harness.equal(selectStorageRuntime({ status: "missing" }).mode, "legacy", "missing marker");
    harness.equal(selectStorageRuntime({ status: "valid", marker: marker("legacy_active", "localStorage", 1) }).mode, "legacy", "legacy marker");
    harness.equal(selectStorageRuntime({ status: "valid", marker: marker("activation_prepared", "localStorage", 1) }).mode, "activation_prepared", "prepared marker");
    harness.equal(selectStorageRuntime({ status: "valid", marker: marker("activating", "indexedDB", 2) }).mode, "activation_boot", "activating marker");
    harness.equal(selectStorageRuntime({ status: "valid", marker: marker("indexeddb_active", "indexedDB", 3) }).mode, "indexeddb_active", "active marker");
    harness.equal(selectStorageRuntime({ status: "invalid", errorCode: "ACTIVATION_MARKER_INVALID" }).mode, "recovery_required", "invalid marker");
    harness.equal(selectStorageRuntime({ status: "valid", marker: marker("activating", "localStorage", 2) }).mode, "recovery_required", "backend conflict");
  });

  harness.test("Activation switch requires four confirmations and writes Journal before Marker before reload", async () => {
    const fixture = await setupSwitch();
    try {
      await harness.rejects(() => fixture.switcher.switch({ ...CONFIRMATIONS, recoveryOnBootFailure: false }), "ACTIVATION_CONFIRMATION_REQUIRED", "four confirmations");
      harness.equal(fixture.lock.acquired, 0, "no lock before confirmation");
      const result = await fixture.switcher.switch(CONFIRMATIONS);
      harness.equal(result.status, "reloading", "reload result");
      harness.equal((await fixture.journals.read("activation-1"))?.status, "switching", "journal switching");
      harness.equal((await new StorageBootstrapMarkerStore(fixture.markerStorage).read()).status, "valid", "marker read-back");
      harness.deepEqual(fixture.events.slice(-3), ["journal", "marker", "reload"], "write order");
      harness.equal(fixture.gate.state, "activation_switching", "old authority frozen");
      harness.equal(fixture.lock.released, 1, "lock released before reload completes");
    } finally { await fixture.close(); }
  });

  harness.test("Activation switch final recheck failure writes no switching evidence and does not reload", async () => {
    const fixture = await setupSwitch(false);
    try {
      await harness.rejects(() => fixture.switcher.switch(CONFIRMATIONS), "ACTIVATION_FINAL_RECHECK_FAILED", "final recheck");
      harness.equal((await fixture.journals.read("activation-1"))?.status, "prepared", "journal unchanged");
      const read = await new StorageBootstrapMarkerStore(fixture.markerStorage).read();
      harness.equal(read.status === "valid" ? read.marker.state : "", "activation_prepared", "marker unchanged");
      harness.equal(fixture.reloads, 0, "no reload");
    } finally { await fixture.close(); }
  });

  harness.test("Activation boot opens IndexedDB, verifies, commits authority and finalizes Marker", async () => {
    const fixture = await setupBoot();
    try {
      const result = await fixture.boot.boot();
      harness.equal(result.status, "indexeddb_active", "runtime ready");
      harness.equal(result.loadResult.state.savedItems.length, fixture.bundle.state.savedItems.length, "hydrated data");
      const metadata = await fixture.adapter.get("migrationMetadata", metadataId("migration-1")) as MigrationExecutionMetadataRecord;
      harness.equal(metadata.activeStorageSwitched, true, "authority committed after verification");
      harness.equal(metadata.rollbackAvailable, false, "migration rollback disabled");
      harness.equal((await fixture.journals.read("activation-1"))?.status, "committed", "journal committed");
      const markerRead = await new StorageBootstrapMarkerStore(fixture.markerStorage).read();
      harness.equal(markerRead.status === "valid" ? markerRead.marker.state : "", "indexeddb_active", "marker finalized");
      harness.equal(fixture.gate.state, "open", "IndexedDB runtime writable");
      harness.assert(fixture.broadcast.posted.some((value) => (value as { type?: string }).type === "storage_backend_activated"), "activation broadcast");
      harness.deepEqual(fixture.legacySnapshot(), fixture.legacyBefore, "legacy product keys unchanged");
    } finally { await fixture.close(); }
  });

  harness.test("Committed IndexedDB boot accepts later runtime writes while retaining activation evidence", async () => {
    const fixture = await setupBoot();
    try {
      const first = await fixture.boot.boot();
      const nextSettings = { ...first.loadResult.settings, themeId: "dawn" };
      await first.runtime.persistProductSettings(first.loadResult.settings, nextSettings);
      await first.runtime.close();

      const second = await fixture.boot.boot();
      harness.equal(second.loadResult.settings.themeId, "dawn", "post-activation setting survives reload");
      harness.equal(second.committedDuringBoot, false, "committed activation is not repeated");
      harness.equal(second.marker.state, "indexeddb_active", "active marker remains authoritative");
      harness.deepEqual(fixture.legacySnapshot(), fixture.legacyBefore, "legacy keys remain byte exact");
    } finally { await fixture.close(); }
  });
  harness.test("Activation boot commit survives Marker failure and Recovery finalizes without rewriting business data", async () => {
    const fixture = await setupBoot();
    try {
      fixture.markerStorage.failNextWrite = true;
      await harness.rejects(() => fixture.boot.boot(), "ACTIVATION_MARKER_FINALIZE_FAILED", "marker finalization failure");
      await fixture.adapter.open();
      const metadata = await fixture.adapter.get("migrationMetadata", metadataId("migration-1")) as MigrationExecutionMetadataRecord;
      harness.equal(metadata.activeStorageSwitched, true, "commit remains authoritative");
      harness.equal((await fixture.journals.read("activation-1"))?.status, "committed", "journal remains committed");
      const recovery = fixture.recovery();
      const repaired = await recovery.finalizeCommittedMarker({ activationId: "activation-1", migrationId: "migration-1" });
      harness.equal(repaired.state, "indexeddb_active", "marker repaired");
      harness.equal(repaired.activeBackend, "indexedDB", "authority not reverted");
      harness.deepEqual(fixture.legacySnapshot(), fixture.legacyBefore, "legacy keys still byte exact");
    } finally { await fixture.close(); }
  });

  harness.test("Recovery permits verified pre-commit cancellation but forbids cancellation after commit", async () => {
    const precommit = await setupBoot();
    try {
      await precommit.adapter.open();
      const legacy = await precommit.recovery().cancelUncommittedActivation({ activationId: "activation-1", migrationId: "migration-1", userConfirmed: true });
      harness.equal(legacy.state, "legacy_active", "precommit returns legacy");
      harness.equal((await precommit.journals.read("activation-1"))?.status, "cancelled", "journal cancelled");
      harness.deepEqual(precommit.legacySnapshot(), precommit.legacyBefore, "legacy source unchanged");
    } finally { await precommit.close(); }

    const committed = await setupBoot();
    try {
      await committed.boot.boot();
      await harness.rejects(
        () => committed.recovery().cancelUncommittedActivation({ activationId: "activation-1", migrationId: "migration-1", userConfirmed: true }),
        "ACTIVATION_CANCEL_AFTER_COMMIT_FORBIDDEN",
        "postcommit cancellation"
      );
    } finally { await committed.close(); }
  });

  harness.test("Recovery action matrix never offers legacy cancellation after commit", () => {
    const committed = createSafeActivationRecoveryReport({
      markerRead: { status: "valid", marker: marker("activating", "indexedDB", 2) },
      journal: { ...journalShape(), status: "committed", committedAt: NOW },
      metadata: { ...metadataShape(), activeStorageSwitched: true, activationId: "activation-1" },
      indexedDbReadable: true,
      backupAvailable: true,
      checkedAt: NOW
    });
    harness.assert(committed.allowedActions.includes("finalize_committed_marker"), "marker repair offered");
    harness.equal(committed.allowedActions.includes("cancel_uncommitted_activation"), false, "no legacy cancel");
    harness.assert(committed.allowedActions.includes("export_indexeddb_snapshot"), "snapshot export offered");
  });

  harness.test("Activation boot failure closes IndexedDB and never opens the legacy write gate", async () => {
    const fixture = await setupBoot();
    try {
      fixture.markerStorage.values.set(STORAGE_BOOTSTRAP_MARKER_KEY, JSON.stringify({ ...marker("activating", "indexedDB", 2), targetRuntimeChecksum: "0".repeat(64) }));
      await harness.rejects(() => fixture.boot.boot(), "ACTIVATION_BOOT_VERIFICATION_FAILED", "checksum mismatch");
      harness.equal(fixture.gate.state, "activation_switching", "no writable fallback");
      harness.equal(fixture.runtime.lifecycle, "closed", "failed target runtime closed");
      harness.deepEqual(fixture.legacySnapshot(), fixture.legacyBefore, "legacy data untouched");
    } finally { await fixture.close(); }
  });

  harness.test("StorageWriteGate blocks old-tab writes during switching and reopens only for IndexedDB authority", () => {
    const gate = new StorageWriteGate();
    gate.markSwitching();
    let blocked = false;
    try { gate.assertWritable(); } catch (error) { blocked = (error as { code?: string }).code === "ACTIVATION_OLD_TAB_WRITE_BLOCKED"; }
    harness.equal(blocked, true, "old tab write blocked");
    gate.markIndexedDbActive();
    gate.assertWritable();
    harness.equal(gate.state, "open", "new runtime gate open");
  });
}

async function setupSwitch(eligible = true) {
  const { createMemoryAdapter } = await import("@revival/storage-service");
  const adapter = createMemoryAdapter();
  await adapter.open();
  const journals = new ActivationJournalRepository(adapter);
  await journals.createOrReuse(journalInput());
  await journals.transition("activation-1", ["preparing"], "prepared", { updatedAt: NOW, bootstrapRevisionPrepared: 1 });
  const markerStorage = new FakeMarkerStorage();
  markerStorage.values.set(STORAGE_BOOTSTRAP_MARKER_KEY, JSON.stringify(marker("activation_prepared", "localStorage", 1)));
  const gate = new StorageWriteGate("activation_prepared");
  const lock = new FakeLockProvider();
  const broadcastChannel = new FakeBroadcastChannel();
  const broadcast = new StorageRuntimeBroadcast(broadcastChannel);
  const events: string[] = [];
  const originalTransition = journals.transition.bind(journals);
  journals.transition = (async (...args: Parameters<typeof originalTransition>) => {
    if (args[2] === "switching" && args[1].includes("prepared")) events.push("journal");
    return originalTransition(...args);
  }) as typeof journals.transition;
  markerStorage.onWrite = () => events.push("marker");
  let reloads = 0;
  const switcher = new ActivationSwitcher({
    lockProvider: lock,
    markerStorage,
    journalRepository: journals,
    writeGate: gate,
    broadcast,
    flushPendingWrites: async () => undefined,
    runFinalPreflight: async () => preflight(marker("activation_prepared", "localStorage", 1), eligible),
    reloader: { reload: () => { reloads += 1; events.push("reload"); } },
    now: () => new Date(NOW)
  });
  return {
    adapter, journals, markerStorage, gate, lock, broadcastChannel, switcher, events,
    get reloads() { return reloads; },
    close: async () => { broadcast.close(); await adapter.close(); }
  };
}

async function setupBoot() {
  const databaseName = `task8d-activation-${++databaseCounter}`;
  const adapter = new IndexedDbAdapter({ databaseName, schemaVersion: 1, indexedDBFactory: fakeIndexedDB, keyRangeFactory: FakeIDBKeyRange });
  const bundle = { state: createInitialDemoData(), settings: { themeId: "sprout", achievements: { welcome: "2026-07-19T00:00:00.000Z" } } };
  await adapter.open();
  const dehydrated = dehydrateRuntimeState(bundle, NOW);
  await adapter.transaction(["savedItems", "actionCards", "planCards", "classificationCorrections", "searchLogs", "smartAlbums", "importBatches", "importBatchItems", "settings"], "readwrite", async (tx) => {
    for (const store of ["savedItems", "actionCards", "planCards", "classificationCorrections", "searchLogs", "smartAlbums", "importBatches", "importBatchItems"] as const) {
      for (const record of dehydrated.stores[store]) await tx.put(store, record as never);
    }
    for (const setting of dehydrated.settings) await tx.put("settings", setting);
  });
  const targetChecksums: Partial<Record<StorageEntityName, string>> = {};
  for (const store of MIGRATION_EXECUTION_STORE_ORDER) targetChecksums[store] = await computeStoreChecksum(store, await adapter.getAll(store) as never[]);
  const metadata = { ...metadataShape(), targetChecksums };
  await adapter.put("migrationMetadata", metadata);
  const journals = new ActivationJournalRepository(adapter);
  await journals.createOrReuse(journalInput(await computeRuntimeBundleChecksum(bundle)));
  await journals.transition("activation-1", ["preparing"], "prepared", { updatedAt: NOW, bootstrapRevisionPrepared: 1 });
  await journals.transition("activation-1", ["prepared"], "switching", { updatedAt: NOW, markerRevisionActivating: 2 });
  await adapter.close();

  const markerStorage = new FakeMarkerStorage();
  const targetRuntimeChecksum = await computeRuntimeBundleChecksum(bundle);
  markerStorage.values.set(STORAGE_BOOTSTRAP_MARKER_KEY, JSON.stringify({ ...marker("activating", "indexedDB", 2), targetRuntimeChecksum }));
  markerStorage.values.set("collection-revival-system:v1", "legacy-app-state-byte-exact");
  markerStorage.values.set("collection-revival-theme", "legacy-theme-byte-exact");
  markerStorage.values.set("collection-revival-achievements", "legacy-achievements-byte-exact");
  const legacySnapshot = () => [
    markerStorage.getItem("collection-revival-system:v1"),
    markerStorage.getItem("collection-revival-theme"),
    markerStorage.getItem("collection-revival-achievements")
  ];
  const legacyBefore = legacySnapshot();
  const gate = new StorageWriteGate("activation_switching");
  const lock = new FakeLockProvider();
  const runtime = new IndexedDbRuntime({ adapter, expectedSchemaVersion: 1, now: () => new Date(NOW) });
  const broadcastChannel = new FakeBroadcastChannel();
  const broadcast = new StorageRuntimeBroadcast(broadcastChannel);
  const boot = new ActivationBootCoordinator({ lockProvider: lock, markerStorage, targetAdapter: adapter, targetRuntime: runtime, journalRepository: journals, writeGate: gate, broadcast, now: () => new Date(NOW) });
  return {
    databaseName, adapter, bundle, journals, markerStorage, gate, lock, runtime, broadcast: broadcastChannel, boot, legacyBefore, legacySnapshot,
    recovery: () => new ActivationRecoveryCoordinator({ lockProvider: lock, markerStorage, targetAdapter: adapter, journalRepository: journals, writeGate: gate, broadcast, verifyLegacySource: async () => true, now: () => new Date(NOW) }),
    close: async () => { broadcast.close(); await runtime.close().catch(() => undefined); await adapter.close().catch(() => undefined); await deleteIndexedDbDatabase(databaseName, fakeIndexedDB); }
  };
}

function marker(state: StorageBootstrapMarkerV1["state"], activeBackend: StorageBootstrapMarkerV1["activeBackend"], revision: number): StorageBootstrapMarkerV1 {
  const base: StorageBootstrapMarkerV1 = { version: 1, revision, state, activeBackend, updatedAt: NOW };
  if (state === "legacy_active") return base;
  return {
    ...base, migrationId: "migration-1", activationId: "activation-1", journalId: "storage-activation:activation-1",
    databaseName: "collection-revival-local", schemaVersion: 1, sourceRawChecksum: "a".repeat(64),
    sourceNormalizedChecksum: "b".repeat(64), targetRuntimeChecksum: "c".repeat(64), preparedAt: NOW,
    ...(state === "activating" || state === "indexeddb_active" ? { activatingAt: NOW } : {}),
    ...(state === "indexeddb_active" ? { activatedAt: NOW } : {})
  };
}

function journalInput(targetRuntimeChecksum = "c".repeat(64)) {
  return {
    activationId: "activation-1", migrationId: "migration-1", sourceRawChecksum: "a".repeat(64),
    sourceNormalizedChecksum: "b".repeat(64), targetRuntimeChecksum, bootstrapRevisionBefore: null,
    preflightSummary: { eligible: true, checkedAt: NOW, blockingIssueCodes: [], warningCodes: [] }, createdAt: NOW
  };
}

function journalShape() {
  return {
    id: "storage-activation:activation-1", recordType: "activation" as const, version: 1 as const, activationId: "activation-1", migrationId: "migration-1",
    sourceBackend: "localStorage" as const, targetBackend: "indexedDB" as const,
    status: "switching" as const, sourceRawChecksum: "a".repeat(64), sourceNormalizedChecksum: "b".repeat(64),
    targetRuntimeChecksum: "c".repeat(64), bootstrapRevisionBefore: null, bootstrapRevisionPrepared: 1, markerRevisionActivating: 2,
    databaseName: "collection-revival-local" as const, schemaVersion: 1 as const,
    preflightSummary: { eligible: true, checkedAt: NOW, blockingIssueCodes: [], warningCodes: [] }, createdAt: NOW, updatedAt: NOW
  };
}

function metadataShape(): MigrationExecutionMetadataRecord {
  return {
    id: metadataId("migration-1"), sourceStorage: "localStorage", targetStorage: "indexedDB", sourceSchemaVersion: 3,
    targetSchemaVersion: 1, status: "completed", executionStatus: "completed", startedAt: NOW, completedAt: NOW,
    warnings: [], previewId: "preview-1", activeStorageSwitched: false, rollbackAvailable: true, resumeCount: 0,
    checkpoints: [], writtenCounts: {}, verifiedCounts: {}, expectedChecksums: {}, targetChecksums: {}
  };
}

function preflight(preparedMarker: StorageBootstrapMarkerV1, eligible: boolean): ActivationPreflightResult {
  const report = {
    eligible, blocking: !eligible, migrationId: "migration-1", activationCandidateId: "activation-1",
    sourceDrift: { drifted: false, blocking: false, changedDomains: [], issues: [], checkedAt: NOW },
    legacyHealth: { ok: true, kind: "localStorage", issues: [], checkedAt: NOW },
    targetHealth: { ok: true, kind: "indexedDB", issues: [], checkedAt: NOW },
    equivalence: { equivalent: true, differences: [] }, backupStatus: { verified: true, rawChecksumMatches: true, normalizedChecksumMatchesMetadata: true },
    migrationStatus: { completed: true, activeStorageSwitched: false, noOtherActiveMigration: true, checkpointsVerified: true, storeChecksumsVerified: true },
    capabilityStatus: { webLocks: true, webCrypto: true, indexedDB: true, indexedDbDatabases: true, broadcastChannel: true, storageEvent: true, localStorageReadable: true, adapterAvailable: true, blocking: [], warnings: [] },
    multiTabStatus: { markerState: "activation_prepared", activeJournalCount: 1, consistent: true }, issues: [], checkedAt: NOW
  } as ActivationPreflightResult["report"];
  return { report, ...(eligible ? { evidence: { sourceRawChecksum: "a".repeat(64), sourceNormalizedChecksum: "b".repeat(64), targetRuntimeChecksum: preparedMarker.targetRuntimeChecksum!, marker: preparedMarker, bootstrapRevisionBefore: preparedMarker.revision } } : {}) };
}

class FakeMarkerStorage implements BootstrapMarkerStorageLike {
  readonly values = new Map<string, string>();
  failNextWrite = false;
  onWrite?: () => void;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("safe marker write failure"); }
    this.values.set(key, value); this.onWrite?.();
  }
  removeItem(key: string): void { this.values.delete(key); }
}
class FakeLockProvider implements MigrationLockProvider {
  readonly kind = "web-locks" as const;
  acquired = 0;
  released = 0;
  isAvailable(): boolean { return true; }
  async acquire(options: MigrationLockAcquireOptions): Promise<MigrationLockHandle> {
    this.acquired += 1;
    return { name: options.name ?? "collection-revival:migration-writer", migrationId: options.migrationId, acquiredAt: NOW, release: async () => { this.released += 1; } };
  }
}
class FakeBroadcastChannel implements BroadcastChannelLike {
  readonly posted: unknown[] = [];
  postMessage(value: unknown): void { this.posted.push(value); }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}