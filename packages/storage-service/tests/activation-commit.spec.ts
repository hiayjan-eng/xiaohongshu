import {
  ActivationCommitRepository,
  ActivationJournalRepository,
  RUNTIME_ACTIVATION_METADATA_KEY,
  createMemoryAdapter,
  metadataId,
  parseRuntimeActivationMetadata,
  type MigrationExecutionMetadataRecord,
  type StorageAdapter,
  type StorageTransaction
} from "../src/index";
import { TestHarness } from "./test-harness";

const CASE_COUNT = 4;
const NOW = "2026-07-19T08:00:00.000Z";

export function runActivationCommitTests(harness: TestHarness): void {
  harness.test("Activation Commit: metadata, Journal and runtime setting commit atomically with read-back", async () => {
    const fixture = await setup();
    try {
      const result = await fixture.commits.commit(commitInput());
      harness.equal(result.idempotent, false, "first commit");
      harness.equal(result.metadata.activeStorageSwitched, true, "authority switched");
      harness.equal(result.metadata.activationId, "activation-1", "activation id saved");
      harness.equal(result.metadata.rollbackAvailable, false, "migration rollback disabled");
      harness.equal(result.journal.status, "committed", "journal committed");
      harness.equal(result.journal.markerRevisionCommitted, 3, "marker revision evidence");
      const setting = await fixture.adapter.get("settings", RUNTIME_ACTIVATION_METADATA_KEY);
      harness.equal(parseRuntimeActivationMetadata(setting)?.migrationId, "migration-1", "runtime metadata read-back");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Commit: identical retry is idempotent and preserves the original commit", async () => {
    const fixture = await setup();
    try {
      const first = await fixture.commits.commit(commitInput());
      const second = await fixture.commits.commit({ ...commitInput(), committedAt: "2026-07-19T09:00:00.000Z" });
      harness.equal(second.idempotent, true, "retry idempotent");
      harness.equal(second.metadata.activeStorageSwitchedAt, first.metadata.activeStorageSwitchedAt, "original activation time retained");
      harness.equal(second.journal.committedAt, first.journal.committedAt, "original journal time retained");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Commit: transaction failure leaves all three records uncommitted", async () => {
    const fixture = await setup();
    try {
      const original = fixture.adapter.transaction.bind(fixture.adapter);
      fixture.adapter.transaction = (async (stores, mode, operation) => original(stores, mode, (tx) => operation(failingSettingTransaction(tx)))) as StorageAdapter["transaction"];
      let rejected = false;
      try { await fixture.commits.commit(commitInput()); } catch { rejected = true; }
      harness.equal(rejected, true, "commit rejected");
      const metadata = await fixture.adapter.get("migrationMetadata", metadataId("migration-1")) as MigrationExecutionMetadataRecord;
      const journal = await fixture.journals.read("activation-1");
      harness.equal(metadata.activeStorageSwitched, false, "metadata rolled back");
      harness.equal(journal?.status, "boot_verifying", "journal rolled back");
      harness.equal(await fixture.adapter.get("settings", RUNTIME_ACTIVATION_METADATA_KEY), undefined, "setting rolled back");
    } finally { await fixture.close(); }
  });

  harness.test("Activation Commit: inconsistent committed evidence is rejected without repair", async () => {
    const fixture = await setup();
    try {
      const metadata = await fixture.adapter.get("migrationMetadata", metadataId("migration-1")) as MigrationExecutionMetadataRecord;
      const corrupted: MigrationExecutionMetadataRecord = { ...metadata, activeStorageSwitched: true, activationId: "different" };
      await fixture.adapter.put("migrationMetadata", corrupted);
      let rejected = false;
      try { await fixture.commits.commit(commitInput()); } catch { rejected = true; }
      harness.equal(rejected, true, "inconsistent evidence rejected");
      harness.equal((await fixture.journals.read("activation-1"))?.status, "boot_verifying", "journal not guessed");
    } finally { await fixture.close(); }
  });
}

export function getActivationCommitCaseCount(): number { return CASE_COUNT; }

async function setup() {
  const adapter = createMemoryAdapter();
  await adapter.open();
  const journals = new ActivationJournalRepository(adapter);
  await adapter.put("migrationMetadata", metadata());
  await journals.createOrReuse({
    activationId: "activation-1",
    migrationId: "migration-1",
    sourceRawChecksum: "a".repeat(64),
    sourceNormalizedChecksum: "b".repeat(64),
    targetRuntimeChecksum: "c".repeat(64),
    bootstrapRevisionBefore: null,
    preflightSummary: { eligible: true, checkedAt: NOW, blockingIssueCodes: [], warningCodes: [] },
    createdAt: NOW
  });
  await journals.transition("activation-1", ["preparing"], "prepared", { updatedAt: NOW, bootstrapRevisionPrepared: 1 });
  await journals.transition("activation-1", ["prepared"], "switching", { updatedAt: NOW, markerRevisionActivating: 2 });
  await journals.transition("activation-1", ["switching"], "boot_verifying", { updatedAt: NOW });
  return { adapter, journals, commits: new ActivationCommitRepository(adapter), close: () => adapter.close() };
}

function metadata(): MigrationExecutionMetadataRecord {
  return {
    id: metadataId("migration-1"), sourceStorage: "localStorage", targetStorage: "indexedDB",
    sourceSchemaVersion: 3, targetSchemaVersion: 1, status: "completed", executionStatus: "completed",
    startedAt: NOW, completedAt: NOW, warnings: [], previewId: "preview-1", activeStorageSwitched: false,
    rollbackAvailable: true, resumeCount: 0, checkpoints: [], writtenCounts: {}, verifiedCounts: {},
    expectedChecksums: {}, targetChecksums: {}
  };
}

function commitInput() {
  return {
    activationId: "activation-1",
    migrationId: "migration-1",
    committedAt: NOW,
    markerRevisionCommitted: 3,
    bootVerificationSummary: {
      verified: true, checkedAt: NOW, runtimeKind: "indexedDB" as const, schemaVersion: 1,
      targetRuntimeChecksumVerified: true, referencesVerified: true, blockingIssueCodes: [], warningCodes: []
    }
  };
}

function failingSettingTransaction(tx: StorageTransaction): StorageTransaction {
  return {
    ...tx,
    put: async (store, value) => {
      if (store === "settings" && (value as { key?: string }).key === RUNTIME_ACTIVATION_METADATA_KEY) throw new Error("safe injected setting failure");
      return tx.put(store, value as never);
    }
  } as StorageTransaction;
}