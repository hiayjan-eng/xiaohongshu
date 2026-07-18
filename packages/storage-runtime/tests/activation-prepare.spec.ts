import {
  ActivationJournalRepository,
  createMemoryAdapter,
  type MigrationLockAcquireOptions,
  type MigrationLockHandle,
  type MigrationLockProvider
} from "@revival/storage-service";
import {
  ActivationPreparer,
  StorageBootstrapMarkerStore,
  StorageRuntimeBroadcast,
  StorageWriteGate,
  type ActivationPreflightResult,
  type BootstrapMarkerStorageLike,
  type BroadcastChannelLike
} from "../src";
import { TestHarness } from "./test-harness";

const CONFIRMATIONS = { prepareOnly: true, freezeOtherPages: true, legacyRemainsActive: true, cancellationAvailable: true } as const;

export function registerActivationPrepareTests(harness: TestHarness): void {
  harness.test("Activation Prepare: requires every confirmation before acquiring a lock", async () => {
    const fixture = await setup();
    try {
      await harness.rejects(() => fixture.preparer.prepare({ ...CONFIRMATIONS, prepareOnly: false }), "ACTIVATION_PREFLIGHT_FAILED", "confirmation gate");
      harness.equal(fixture.lock.acquired, 0, "no lock acquired");
      harness.equal(fixture.markerStorage.writes, 0, "no marker written");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Prepare: flushes, writes Journal then Marker, and retains localStorage authority", async () => {
    const fixture = await setup();
    try {
      const result = await fixture.preparer.prepare(CONFIRMATIONS);
      harness.equal(result.status, "activation_prepared", "prepared result");
      harness.equal(result.activeBackend, "localStorage", "legacy authority");
      harness.equal(result.activeStorageSwitched, false, "not activated");
      harness.equal(fixture.flushes, 1, "pending writes flushed");
      harness.equal(fixture.lock.released, 1, "lock released");
      harness.equal(fixture.gate.state, "activation_prepared", "writes frozen");
      const marker = await new StorageBootstrapMarkerStore(fixture.markerStorage).read();
      harness.equal(marker.status === "valid" ? marker.marker.state : "", "activation_prepared", "marker state");
      harness.equal((await fixture.repository.read("activation-1"))?.status, "prepared", "journal finalized");
      harness.deepEqual(fixture.broadcast.posted.map((entry) => (entry as { type: string }).type), ["activation_preflight_started", "activation_prepared"], "broadcast order");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Prepare: an ineligible final preflight writes neither Marker nor prepared Journal", async () => {
    const fixture = await setup({ eligible: false });
    try {
      await harness.rejects(() => fixture.preparer.prepare(CONFIRMATIONS), "ACTIVATION_PREFLIGHT_FAILED", "blocking preflight");
      harness.equal(fixture.markerStorage.writes, 0, "no marker");
      harness.equal((await fixture.repository.list()).length, 0, "no journal before eligible evidence");
      harness.equal(fixture.gate.state, "open", "gate reopened");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Prepare: flush failure blocks before source check and reopens the write gate", async () => {
    const fixture = await setup({ failFlush: true });
    try {
      await harness.rejects(() => fixture.preparer.prepare(CONFIRMATIONS), "ACTIVATION_WRITE_GATE_FAILED", "flush failure");
      harness.equal(fixture.preflightRuns, 0, "no source check");
      harness.equal(fixture.markerStorage.writes, 0, "no marker");
      harness.equal(fixture.gate.state, "open", "gate reopened");
      harness.equal(fixture.lock.released, 1, "lock released");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Prepare: a non-Web-Locks provider is rejected without fallback", async () => {
    const fixture = await setup({ lockKind: "memory" });
    try {
      await harness.rejects(() => fixture.preparer.prepare(CONFIRMATIONS), "ACTIVATION_CAPABILITY_UNAVAILABLE", "memory lock rejected");
      harness.equal(fixture.lock.acquired, 0, "no fallback lock");
      harness.equal(fixture.markerStorage.writes, 0, "no marker");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Prepare: repeated prepare is idempotent and does not replace immutable evidence", async () => {
    const fixture = await setup();
    try {
      const first = await fixture.preparer.prepare(CONFIRMATIONS);
      fixture.setPreflight(preflightResult(first.marker));
      const second = await fixture.preparer.prepare(CONFIRMATIONS);
      harness.equal(second.idempotent, true, "idempotent repeat");
      harness.equal((await fixture.repository.list()).length, 1, "one journal");
      harness.equal(fixture.markerStorage.writes, 1, "marker not rewritten");
    } finally { await fixture.close(); }
  });

  harness.test("Cancel Prepare: consistent Marker and Journal return to legacy_active without clearing target evidence", async () => {
    const fixture = await setup();
    try {
      await fixture.preparer.prepare(CONFIRMATIONS);
      const result = await fixture.preparer.cancelPrepare({ activationId: "activation-1", migrationId: "migration-1", userConfirmed: true });
      harness.equal(result.status, "prepare_cancelled", "cancelled result");
      harness.equal(result.marker.state, "legacy_active", "legacy marker");
      harness.equal(result.marker.activeBackend, "localStorage", "legacy authority");
      harness.equal((await fixture.repository.read("activation-1"))?.status, "cancelled", "journal history retained");
      harness.equal(fixture.gate.state, "open", "writes reopened");
      harness.assert(fixture.broadcast.posted.some((entry) => (entry as { type: string }).type === "activation_prepare_cancelled"), "cancel broadcast");
    } finally { await fixture.close(); }
  });

  harness.test("Cancel Prepare: explicit confirmation and inactive migration are mandatory", async () => {
    const fixture = await setup();
    try {
      await fixture.preparer.prepare(CONFIRMATIONS);
      await harness.rejects(() => fixture.preparer.cancelPrepare({ activationId: "activation-1", migrationId: "migration-1", userConfirmed: false }), "ACTIVATION_CANCEL_NOT_ALLOWED", "cancel confirmation");
      fixture.migrationInactive = false;
      await harness.rejects(() => fixture.preparer.cancelPrepare({ activationId: "activation-1", migrationId: "migration-1", userConfirmed: true }), "ACTIVATION_CANCEL_NOT_ALLOWED", "active migration");
      harness.equal((await fixture.repository.read("activation-1"))?.status, "prepared", "prepared history retained");
    } finally { await fixture.close(); }
  });
}

async function setup(options: { eligible?: boolean; failFlush?: boolean; lockKind?: "web-locks" | "memory" } = {}) {
  const adapter = createMemoryAdapter();
  await adapter.open();
  const repository = new ActivationJournalRepository(adapter);
  const markerStorage = new FakeMarkerStorage();
  const gate = new StorageWriteGate();
  const broadcastChannel = new FakeBroadcastChannel();
  const broadcast = new StorageRuntimeBroadcast(broadcastChannel);
  const lock = new FakeLockProvider(options.lockKind ?? "web-locks");
  let currentPreflight = preflightResult(undefined, options.eligible ?? true);
  const context = {
    flushes: 0,
    preflightRuns: 0,
    migrationInactive: true
  };
  const preparer = new ActivationPreparer({
    lockProvider: lock,
    markerStorage,
    journalRepository: repository,
    writeGate: gate,
    broadcast,
    flushPendingWrites: async () => { context.flushes += 1; if (options.failFlush) throw new Error("safe injected failure"); },
    runPreflight: async () => { context.preflightRuns += 1; return currentPreflight; },
    assertMigrationInactive: async () => context.migrationInactive,
    now: () => new Date("2026-07-18T00:00:00.000Z")
  });
  return {
    adapter, repository, markerStorage, gate, broadcast: broadcastChannel, lock, preparer,
    get flushes() { return context.flushes; },
    get preflightRuns() { return context.preflightRuns; },
    get migrationInactive() { return context.migrationInactive; },
    set migrationInactive(value: boolean) { context.migrationInactive = value; },
    setPreflight(value: ActivationPreflightResult) { currentPreflight = value; },
    close: async () => { broadcast.close(); await adapter.close(); }
  };
}

class FakeMarkerStorage implements BootstrapMarkerStorageLike {
  readonly values = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.writes += 1; this.values.set(key, value); }
  removeItem(key: string): void { this.writes += 1; this.values.delete(key); }
}

class FakeLockProvider implements MigrationLockProvider {
  acquired = 0;
  released = 0;
  constructor(readonly kind: "web-locks" | "memory") {}
  isAvailable(): boolean { return true; }
  async acquire(options: MigrationLockAcquireOptions): Promise<MigrationLockHandle> {
    this.acquired += 1;
    return {
      name: options.name ?? "collection-revival:migration-writer",
      migrationId: options.migrationId,
      acquiredAt: "2026-07-18T00:00:00.000Z",
      release: async () => { this.released += 1; }
    };
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  readonly posted: unknown[] = [];
  postMessage(message: unknown): void { this.posted.push(message); }
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

function preflightResult(marker?: ActivationPreflightResult["evidence"] extends infer E ? E extends { marker?: infer M } ? M : never : never, eligible = true): ActivationPreflightResult {
  const report = {
    eligible,
    blocking: !eligible,
    migrationId: "migration-1",
    activationCandidateId: "activation-1",
    sourceDrift: { drifted: false, blocking: false, changedDomains: [], issues: [], checkedAt: "2026-07-18T00:00:00.000Z" },
    legacyHealth: { ok: true, kind: "localStorage", issues: [], checkedAt: "2026-07-18T00:00:00.000Z" },
    targetHealth: { ok: true, kind: "indexedDB", issues: [], checkedAt: "2026-07-18T00:00:00.000Z" },
    equivalence: { equivalent: true, differences: [] },
    backupStatus: { verified: true, rawChecksumMatches: true, normalizedChecksumMatchesMetadata: true },
    migrationStatus: { completed: true, activeStorageSwitched: false, noOtherActiveMigration: true, checkpointsVerified: true, storeChecksumsVerified: true },
    capabilityStatus: { webLocks: true, webCrypto: true, indexedDB: true, indexedDbDatabases: true, broadcastChannel: true, storageEvent: true, localStorageReadable: true, adapterAvailable: true, blocking: [], warnings: [] },
    multiTabStatus: { markerState: marker ? "activation_prepared" : "missing", activeJournalCount: marker ? 1 : 0, consistent: true },
    issues: [],
    checkedAt: "2026-07-18T00:00:00.000Z"
  } as ActivationPreflightResult["report"];
  return {
    report,
    ...(eligible ? { evidence: {
      sourceRawChecksum: "a".repeat(64),
      sourceNormalizedChecksum: "b".repeat(64),
      targetRuntimeChecksum: "c".repeat(64),
      marker,
      bootstrapRevisionBefore: marker?.revision ?? null
    } } : {})
  };
}