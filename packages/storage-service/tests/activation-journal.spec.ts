import {
  ActivationJournalRepository,
  activationJournalId,
  createMemoryAdapter,
  isStorageActivationJournal,
  type CreateActivationJournalInput,
  type MigrationMetadata
} from "../src/index";
import { expectStorageError, TestHarness } from "./test-harness";

const CASE_COUNT = 10;

export function runActivationJournalTests(harness: TestHarness): void {
  harness.test("Activation Journal: record type, schema and safe immutable fields", async () => {
    const { repository, close } = await setup();
    try {
      const result = await repository.createOrReuse(input());
      harness.equal(result.journal.id, activationJournalId("activation-1"), "journal id");
      harness.equal(result.journal.recordType, "activation", "record type");
      harness.equal(result.journal.status, "preparing", "initial status");
      harness.equal(result.journal.schemaVersion, 1, "schema v1");
      harness.assert(!JSON.stringify(result.journal).includes("userNote"), "no user content");
    } finally { await close(); }
  });

  harness.test("Activation Journal: same id and immutable content are reused", async () => {
    const { repository, close } = await setup();
    try {
      const first = await repository.createOrReuse(input());
      const second = await repository.createOrReuse(input());
      harness.equal(first.reused, false, "first creates");
      harness.equal(second.reused, true, "second reuses");
      harness.equal((await repository.list()).length, 1, "one journal");
    } finally { await close(); }
  });

  harness.test("Activation Journal: repeat evidence reuses the original record across inspection timestamps", async () => {
    const { repository, close } = await setup();
    try {
      const first = await repository.createOrReuse(input());
      const second = await repository.createOrReuse({
        ...input(),
        createdAt: "2026-07-18T00:05:00.000Z",
        preflightSummary: { eligible: true, checkedAt: "2026-07-18T00:05:00.000Z", blockingIssueCodes: [], warningCodes: ["SAFE_WARNING"] }
      });
      harness.equal(second.reused, true, "same activation evidence reused");
      harness.equal(second.journal.createdAt, first.journal.createdAt, "original creation time retained");
      harness.deepEqual(second.journal.preflightSummary, first.journal.preflightSummary, "original safe summary retained");
    } finally { await close(); }
  });

  harness.test("Activation Journal: same id with different content conflicts", async () => {
    const { repository, close } = await setup();
    try {
      await repository.createOrReuse(input());
      await expectStorageError(harness, () => repository.createOrReuse({ ...input(), migrationId: "migration-2" }), "STORAGE_CONFLICT", "identity conflict");
      harness.equal((await repository.read("activation-1"))?.migrationId, "migration-1", "original retained");
    } finally { await close(); }
  });

  harness.test("Activation Journal: preparing transitions to prepared and cancelled with read-back", async () => {
    const { repository, close } = await setup();
    try {
      await repository.createOrReuse(input());
      const prepared = await repository.transition("activation-1", ["preparing"], "prepared", { updatedAt: "2026-07-18T00:01:00.000Z", bootstrapRevisionPrepared: 1 });
      harness.equal(prepared.status, "prepared", "prepared");
      harness.equal(prepared.bootstrapRevisionPrepared, 1, "marker revision");
      const cancelled = await repository.transition("activation-1", ["prepared"], "cancelled", { updatedAt: "2026-07-18T00:02:00.000Z" });
      harness.equal(cancelled.status, "cancelled", "cancelled");
      harness.equal((await repository.read("activation-1"))?.status, "cancelled", "cancel read-back");
    } finally { await close(); }
  });

  harness.test("Activation Journal: prepared cannot be overwritten by prepare failure", async () => {
    const { repository, close } = await setup();
    try {
      await repository.createOrReuse(input());
      await repository.transition("activation-1", ["preparing"], "prepared", { updatedAt: "2026-07-18T00:01:00.000Z", bootstrapRevisionPrepared: 1 });
      await expectStorageError(harness, () => repository.transition("activation-1", ["preparing"], "prepare_failed", { updatedAt: "2026-07-18T00:02:00.000Z" }), "STORAGE_CONFLICT", "prepared immutable");
    } finally { await close(); }
  });

  harness.test("Activation Journal: prepared advances through switching, boot verification and committed", async () => {
    const { repository, close } = await setup();
    try {
      await repository.createOrReuse(input());
      await repository.transition("activation-1", ["preparing"], "prepared", { updatedAt: "2026-07-18T00:01:00.000Z", bootstrapRevisionPrepared: 1 });
      const switching = await repository.transition("activation-1", ["prepared"], "switching", { updatedAt: "2026-07-18T00:02:00.000Z", markerRevisionActivating: 2 });
      const verifying = await repository.transition("activation-1", ["switching"], "boot_verifying", { updatedAt: "2026-07-18T00:03:00.000Z" });
      const committed = await repository.transition("activation-1", ["boot_verifying"], "committed", { updatedAt: "2026-07-18T00:04:00.000Z", markerRevisionCommitted: 3 });
      harness.equal(switching.switchingAt, "2026-07-18T00:02:00.000Z", "switching timestamp");
      harness.equal(verifying.bootVerifyingAt, "2026-07-18T00:03:00.000Z", "verification timestamp");
      harness.equal(committed.committedAt, "2026-07-18T00:04:00.000Z", "commit timestamp");
      harness.equal(committed.markerRevisionCommitted, 3, "committed marker revision");
    } finally { await close(); }
  });

  harness.test("Activation Journal: committed is terminal and cannot be cancelled", async () => {
    const { repository, close } = await setup();
    try {
      await repository.createOrReuse(input());
      await repository.transition("activation-1", ["preparing"], "prepared", { updatedAt: "2026-07-18T00:01:00.000Z", bootstrapRevisionPrepared: 1 });
      await repository.transition("activation-1", ["prepared"], "switching", { updatedAt: "2026-07-18T00:02:00.000Z" });
      await repository.transition("activation-1", ["switching"], "boot_verifying", { updatedAt: "2026-07-18T00:03:00.000Z" });
      await repository.transition("activation-1", ["boot_verifying"], "committed", { updatedAt: "2026-07-18T00:04:00.000Z" });
      await expectStorageError(harness, () => repository.transition("activation-1", ["committed"], "cancelled", { updatedAt: "2026-07-18T00:05:00.000Z" }), "STORAGE_CONFLICT", "committed terminal");
      harness.equal((await repository.read("activation-1"))?.status, "committed", "commit retained");
    } finally { await close(); }
  });
  harness.test("Activation Journal: migration records remain distinguishable", async () => {
    const { adapter, repository, close } = await setup();
    try {
      const migration: MigrationMetadata = { id: "migration-execution:migration-1", sourceStorage: "localStorage", targetStorage: "indexedDB", sourceSchemaVersion: 3, targetSchemaVersion: 1, status: "completed", startedAt: "2026-07-18T00:00:00.000Z", warnings: [] };
      await adapter.put("migrationMetadata", migration);
      await repository.createOrReuse(input());
      const all = await adapter.getAll("migrationMetadata");
      harness.equal(all.length, 2, "shared store records");
      harness.equal(all.filter(isStorageActivationJournal).length, 1, "only activation narrowed");
    } finally { await close(); }
  });

  harness.test("Activation Journal: transaction failure does not create a partial record", async () => {
    const { adapter, repository, close } = await setup();
    try {
      await expectStorageError(harness, () => repository.transition("missing", ["preparing"], "prepared", { updatedAt: "2026-07-18T00:01:00.000Z" }), "STORAGE_CONFLICT", "missing journal");
      harness.equal((await adapter.getAll("migrationMetadata")).length, 0, "no partial record");
    } finally { await close(); }
  });
}

export function getActivationJournalCaseCount(): number { return CASE_COUNT; }

async function setup() {
  const adapter = createMemoryAdapter();
  await adapter.open();
  return { adapter, repository: new ActivationJournalRepository(adapter), close: () => adapter.close() };
}

function input(): CreateActivationJournalInput {
  return {
    activationId: "activation-1",
    migrationId: "migration-1",
    sourceRawChecksum: "a".repeat(64),
    sourceNormalizedChecksum: "b".repeat(64),
    targetRuntimeChecksum: "c".repeat(64),
    bootstrapRevisionBefore: null,
    preflightSummary: { eligible: true, checkedAt: "2026-07-18T00:00:00.000Z", blockingIssueCodes: [], warningCodes: [] },
    createdAt: "2026-07-18T00:00:00.000Z"
  };
}