import { createInitialDemoData } from "@revival/database";
import {
  LEGACY_ACHIEVEMENT_STORAGE_KEY,
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  LegacyLocalStorageSnapshotReader,
  computeSha256,
  serializeLegacyBackup,
  type MigrationExecutionMetadataRecord,
  type PersistedMigrationBackup,
  type ReadonlyStorageLike
} from "@revival/storage-service";
import {
  ACTIVATION_LEGACY_SOURCE_KEYS,
  STORAGE_BOOTSTRAP_MARKER_KEY,
  StorageBootstrapMarkerStore,
  StorageRuntimeBroadcast,
  StorageWriteGate,
  checkSourceDrift,
  createLegacyActiveMarker,
  inspectBrowserActivationCapabilities,
  isStorageRuntimeBroadcastMessage,
  type BroadcastChannelLike,
  type StorageBootstrapMarkerV1
} from "../src";
import { TestHarness } from "./test-harness";

export function registerActivationPrimitiveTests(harness: TestHarness): void {
  harness.test("Bootstrap Marker: construction is inert, missing is safe, and writes require the writer lock", async () => {
    const storage = new FakeStorage();
    let held = false;
    const store = new StorageBootstrapMarkerStore(storage, { assertWriteLockHeld: () => held });
    harness.equal(storage.reads, 0, "constructor read count");
    harness.equal((await store.read()).status, "missing", "missing marker");
    await harness.rejects(() => store.writeExpectedRevision(null, preparedMarker(1)), "ACTIVATION_CONFLICT", "write without lock");
    harness.equal(storage.values.has(STORAGE_BOOTSTRAP_MARKER_KEY), false, "no marker write");
    held = true;
    await store.writeExpectedRevision(null, preparedMarker(1));
    const read = await store.read();
    harness.equal(read.status, "valid", "prepared marker read-back");
    harness.equal(read.status === "valid" ? read.marker.activeBackend : "", "localStorage", "legacy authority retained");
  });

  harness.test("Bootstrap Marker: revision compare-before-write and cancellation marker are deterministic", async () => {
    const storage = new FakeStorage();
    const store = new StorageBootstrapMarkerStore(storage, { assertWriteLockHeld: () => true });
    const prepared = preparedMarker(1);
    await store.writeExpectedRevision(null, prepared);
    await harness.rejects(() => store.writeExpectedRevision(null, preparedMarker(1)), "ACTIVATION_MARKER_REVISION_CONFLICT", "stale revision");
    const legacy = createLegacyActiveMarker(prepared, "2026-07-18T00:01:00.000Z");
    await store.writeExpectedRevision(1, legacy);
    const read = await store.read();
    harness.equal(read.status === "valid" ? read.marker.state : "", "legacy_active", "cancel state");
    harness.equal(read.status === "valid" ? read.marker.revision : 0, 2, "monotonic revision");
  });

  harness.test("Bootstrap Marker: corrupt JSON and unsupported versions never guess a backend", async () => {
    const storage = new FakeStorage();
    storage.values.set(STORAGE_BOOTSTRAP_MARKER_KEY, "{broken");
    const store = new StorageBootstrapMarkerStore(storage);
    harness.equal((await store.read()).status, "invalid", "corrupt marker");
    storage.values.set(STORAGE_BOOTSTRAP_MARKER_KEY, JSON.stringify({ version: 9 }));
    harness.equal((await store.read()).status, "unsupported", "future version");
  });

  harness.test("StorageWriteGate: preflight and prepared states block writes and cancellation reopens", async () => {
    const gate = new StorageWriteGate();
    const states: string[] = [];
    gate.subscribe((state) => states.push(state));
    gate.assertWritable();
    gate.enterPreflight();
    await harness.rejects(async () => gate.assertWritable(), "ACTIVATION_WRITE_GATE_FAILED", "preflight gate");
    gate.markPrepared();
    await harness.rejects(async () => gate.assertWritable(), "ACTIVATION_WRITE_GATE_FAILED", "prepared gate");
    gate.reopen();
    gate.assertWritable();
    harness.deepEqual(states, ["activation_preflight", "activation_prepared", "open"], "gate notifications");
  });

  harness.test("StorageRuntimeBroadcast: publishes only safe protocol messages", () => {
    const channel = new FakeBroadcastChannel();
    const broadcast = new StorageRuntimeBroadcast(channel);
    const received: string[] = [];
    broadcast.subscribe((message) => received.push(message.type));
    broadcast.publish({ type: "activation_preflight_started", activationId: "activation-1", revision: 0 });
    harness.equal(channel.posted.length, 1, "published message");
    channel.emit({ type: "activation_prepared", activationId: "activation-1", revision: 1 });
    channel.emit({ type: "unknown", userNote: "secret" });
    harness.deepEqual(received, ["activation_prepared"], "invalid message ignored");
    harness.equal(isStorageRuntimeBroadcastMessage({ type: "activation_prepare_cancelled", activationId: "a", revision: 2 }), true, "cancel message valid");
    broadcast.close();
  });

  harness.test("Activation capabilities: critical browser APIs block while safe notification fallbacks warn", () => {
    const blocked = inspectBrowserActivationCapabilities({ webLocks: false, webCrypto: true, indexedDB: true, indexedDbDatabases: true, broadcastChannel: true, storageEvent: true, localStorageReadable: true, adapterAvailable: true });
    harness.assert(blocked.blocking.includes("WEB_LOCKS_UNAVAILABLE"), "Web Locks blocking");
    const fallback = inspectBrowserActivationCapabilities({ webLocks: true, webCrypto: true, indexedDB: true, indexedDbDatabases: false, broadcastChannel: false, storageEvent: true, localStorageReadable: true, adapterAvailable: true, completedSessionKnowsDatabaseExists: true });
    harness.equal(fallback.blocking.length, 0, "known database and storage event suffice");
    harness.assert(fallback.warnings.includes("BROADCAST_CHANNEL_UNAVAILABLE"), "BroadcastChannel warning");
  });

  harness.test("Source Drift: unchanged AppState, theme and achievements remain equivalent", async () => {
    const fixture = await makeSourceFixture();
    const report = await checkSourceDrift(fixture.input);
    harness.equal(report.drifted, false, "no drift");
    harness.equal(report.blocking, false, "not blocking");
    harness.deepEqual(report.changedDomains, [], "no changed domains");
    harness.equal(report.currentRawChecksum, report.expectedRawChecksum, "raw checksum");
    harness.equal(report.currentNormalizedChecksum, report.expectedNormalizedChecksum, "runtime checksum");
  });

  harness.test("Source Drift: each authoritative legacy domain is reported and internal keys are ignored", async () => {
    const fixture = await makeSourceFixture();
    fixture.storage.values.set("developerMode", "true");
    harness.equal((await checkSourceDrift(fixture.input)).drifted, false, "internal key ignored");
    for (const [key, domain] of [
      [LEGACY_APP_STATE_STORAGE_KEY, "app_state"],
      [LEGACY_THEME_STORAGE_KEY, "theme"],
      [LEGACY_ACHIEVEMENT_STORAGE_KEY, "achievements"]
    ] as const) {
      const original = fixture.storage.values.get(key)!;
      fixture.storage.values.set(key, `${original} `);
      const report = await checkSourceDrift(fixture.input);
      harness.equal(report.drifted, true, `${domain} drift`);
      harness.assert(report.changedDomains.includes(domain), `${domain} domain`);
      fixture.storage.values.set(key, original);
    }
    harness.deepEqual([...ACTIVATION_LEGACY_SOURCE_KEYS], [LEGACY_APP_STATE_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY, LEGACY_ACHIEVEMENT_STORAGE_KEY], "fixed drift keys");
  });

  harness.test("Source Drift: corrupt source and metadata-backup checksum conflicts block without content disclosure", async () => {
    const fixture = await makeSourceFixture();
    fixture.storage.values.set(LEGACY_APP_STATE_STORAGE_KEY, "{broken secret userNote");
    let report = await checkSourceDrift(fixture.input);
    harness.equal(report.blocking, true, "corrupt source blocks");
    harness.assert(report.issues.some((issue) => issue.code === "SOURCE_UNREADABLE"), "safe unreadable issue");
    fixture.storage.values.set(LEGACY_APP_STATE_STORAGE_KEY, fixture.originalAppState);
    fixture.input.migrationMetadata.sourceSnapshotChecksum = "f".repeat(64);
    report = await checkSourceDrift(fixture.input);
    harness.assert(report.issues.some((issue) => issue.code === "SOURCE_METADATA_BACKUP_CONFLICT"), "metadata conflict");
    harness.equal(JSON.stringify(report.issues).includes("userNote"), false, "no user content");
  });
}

class FakeStorage implements ReadonlyStorageLike {
  readonly values = new Map<string, string>();
  reads = 0;
  writes = 0;
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { this.reads += 1; return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.writes += 1; this.values.set(key, value); }
  removeItem(key: string): void { this.writes += 1; this.values.delete(key); }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  readonly posted: unknown[] = [];
  private listener?: (event: MessageEvent) => void;
  postMessage(message: unknown): void { this.posted.push(message); }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void { this.listener = listener; }
  removeEventListener(): void { this.listener = undefined; }
  close(): void { this.listener = undefined; }
  emit(data: unknown): void { this.listener?.({ data } as MessageEvent); }
}

function preparedMarker(revision: number): StorageBootstrapMarkerV1 {
  return {
    version: 1,
    revision,
    state: "activation_prepared",
    activeBackend: "localStorage",
    migrationId: "migration-1",
    activationId: "activation-1",
    journalId: "activation:activation-1",
    databaseName: "collection-revival-local",
    schemaVersion: 1,
    sourceRawChecksum: "a".repeat(64),
    sourceNormalizedChecksum: "b".repeat(64),
    targetRuntimeChecksum: "c".repeat(64),
    preparedAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
}

async function makeSourceFixture() {
  const storage = new FakeStorage();
  const appState = JSON.stringify(createInitialDemoData());
  storage.values.set(LEGACY_APP_STATE_STORAGE_KEY, appState);
  storage.values.set(LEGACY_THEME_STORAGE_KEY, "sprout");
  storage.values.set(LEGACY_ACHIEVEMENT_STORAGE_KEY, JSON.stringify({ welcome: "done" }));
  const now = () => new Date("2026-07-18T00:00:00.000Z");
  const envelope = await new LegacyLocalStorageSnapshotReader(storage, { now, createBackupId: () => "backup-1" }).createBackupEnvelope();
  const serializedEnvelope = serializeLegacyBackup(envelope);
  const persistedBackup: PersistedMigrationBackup = {
    migrationId: "migration-1",
    recordId: "legacy-backup:backup-1",
    serializedEnvelope,
    envelope,
    byteLength: new TextEncoder().encode(serializedEnvelope).byteLength,
    checksum: await computeSha256(serializedEnvelope),
    verifiedAt: now().toISOString()
  };
  const migrationMetadata = {
    id: "migration-execution:migration-1",
    sourceStorage: "localStorage",
    targetStorage: "indexedDB",
    sourceSchemaVersion: 3,
    targetSchemaVersion: 1,
    status: "completed",
    executionStatus: "completed",
    previewId: "preview-1",
    activeStorageSwitched: false,
    rollbackAvailable: true,
    resumeCount: 0,
    checkpoints: [],
    writtenCounts: {},
    verifiedCounts: {},
    expectedChecksums: {},
    targetChecksums: {},
    warnings: [],
    startedAt: now().toISOString(),
    completedAt: now().toISOString(),
    sourceSnapshotChecksum: envelope.checksums.normalized
  } as MigrationExecutionMetadataRecord;
  return { storage, originalAppState: appState, input: { readonlyStorage: storage, migrationMetadata, backup: persistedBackup, now } };
}