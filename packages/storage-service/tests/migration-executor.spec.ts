import {
  IDBKeyRange as FakeIDBKeyRange,
  indexedDB as fakeIndexedDB
} from "fake-indexeddb";
import {
  MemoryMigrationLockProvider,
  createIndexedDbAdapter,
  createMigrationExecutor,
  computeStoreChecksum,
  deleteIndexedDbDatabase,
  metadataId,
  type MigrationExecutionMetadataRecord,
  type StorageEntityName
} from "../src/index";
import { makeSavedItem } from "./fixtures";
import { createMigrationExecutionFixture, makeExecutionState } from "./migration-executor-fixtures";
import { expectStorageError, TestHarness } from "./test-harness";

const CASE_COUNT = 15;

export function runMigrationExecutorTests(harness: TestHarness): void {
  harness.test("MigrationExecutor: executes an approved plan into target storage", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const progress: string[] = [];
    const executor = createMigrationExecutor({
      targetAdapter: target,
      now: () => new Date("2026-07-15T00:00:00.000Z"),
      onProgress: (event) => progress.push(event.status)
    });

    const result = await executor.execute({ envelope, preview, userConfirmed: true });
    harness.equal(result.status, "completed", "result status");
    harness.equal(result.activeStorageSwitched, false, "activeStorage stays untouched");
    harness.equal((await target.getAll("savedItems")).length, 1, "saved items written");
    harness.equal((await target.getAll("actionCards")).length, 1, "action cards written");
    harness.equal((await target.getAll("backups")).length, 1, "backup record written");
    harness.equal((await target.getAll("migrationMetadata")).length, 1, "metadata written");
    harness.assert(progress.includes("backup_persisted"), "progress includes backup persisted");
    harness.assert(result.checkpoints.every((checkpoint) => checkpoint.status === "verified"), "all checkpoints verified");
  });

  harness.test("MigrationExecutor: executes against IndexedDbAdapter without product runtime wiring", async () => {
    const { envelope, preview } = await createMigrationExecutionFixture({ migrationId: "migration_indexeddb_execution" });
    const databaseName = `collection-revival-migration-executor-${Date.now()}`;
    const target = createIndexedDbAdapter({
      databaseName,
      indexedDBFactory: fakeIndexedDB,
      keyRangeFactory: FakeIDBKeyRange
    });
    try {
      const executor = createMigrationExecutor({ targetAdapter: target });
      const result = await executor.execute({ envelope, preview, userConfirmed: true });
      harness.equal(result.status, "completed", "indexeddb migration status");
      harness.equal((await target.getAll("savedItems")).length, 1, "indexeddb saved item");
      harness.equal((await target.getAll("migrationMetadata")).length, 1, "indexeddb metadata");
    } finally {
      await target.close();
      await deleteIndexedDbDatabase(databaseName, fakeIndexedDB);
    }
  });

  harness.test("MigrationExecutor: refuses to execute without explicit user confirmation", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: false }),
      "MIGRATION_USER_CONFIRMATION_REQUIRED",
      "user confirmation"
    );
    harness.equal((await target.getAll("savedItems")).length, 0, "no data written");
  });

  harness.test("MigrationExecutor: refuses blocked preview plans", async () => {
    const state = makeExecutionState({
      savedItems: [{ ...makeSavedItem("saved-001"), id: "" }]
    });
    const { envelope, preview, target } = await createMigrationExecutionFixture({ state });
    const executor = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_PREVIEW_BLOCKED",
      "blocked preview"
    );
  });

  harness.test("MigrationExecutor: target business data must be empty before first execution", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    await target.put("savedItems", makeSavedItem("existing"));
    const executor = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_TARGET_NOT_EMPTY",
      "target not empty"
    );
  });

  harness.test("MigrationExecutor: completed execution is idempotent", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await executor.execute({ envelope, preview, userConfirmed: true });
    const second = await executor.execute({ envelope, preview, userConfirmed: true });
    harness.equal(second.status, "completed", "second status");
    harness.equal(second.idempotent, true, "idempotent result");
    harness.equal((await target.getAll("savedItems")).length, 1, "no duplicate saved item");
  });

  harness.test("MigrationExecutor: failure after a store write can resume from checkpoint", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    let failedOnce = false;
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        afterStoreWrite({ store }) {
          if (store === "savedItems" && !failedOnce) {
            failedOnce = true;
            throw new Error("simulated after write failure");
          }
        }
      }
    });

    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "simulated write failure"
    );
    harness.equal((await target.getAll("savedItems")).length, 1, "store transaction had committed before failure");
    const resumed = await executor.resume({ migrationId: preview.migrationId, envelope, preview, userConfirmed: true });
    harness.equal(resumed.status, "completed", "resume status");
    harness.equal(resumed.resumed, true, "resume count reflected");
    harness.equal((await target.getAll("planCards")).length, 1, "remaining stores written");
  });

  harness.test("MigrationExecutor: resume detects checkpoint conflicts", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        afterStoreWrite({ store }) {
          if (store === "savedItems") throw new Error("stop after savedItems");
        }
      }
    });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "create partial checkpoint"
    );
    await target.put("savedItems", makeSavedItem("saved-001", { userNote: "changed target note" }));
    await expectStorageError(
      harness,
      () => executor.resume({ migrationId: preview.migrationId, envelope, preview, userConfirmed: true }),
      "MIGRATION_RESUME_CONFLICT",
      "resume conflict"
    );
  });

  harness.test("MigrationExecutor: rollback clears migrated business stores but keeps backup and metadata", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await executor.execute({ envelope, preview, userConfirmed: true });
    const rolledBack = await executor.rollback({ migrationId: preview.migrationId });
    harness.equal(rolledBack.status, "rolled_back", "rollback status");
    harness.equal((await target.getAll("savedItems")).length, 0, "savedItems cleared");
    harness.equal((await target.getAll("actionCards")).length, 0, "actionCards cleared");
    harness.equal((await target.getAll("backups")).length, 1, "backup retained");
    harness.equal((await target.getAll("migrationMetadata")).length, 1, "metadata retained");
    const secondRollback = await executor.rollback({ migrationId: preview.migrationId });
    harness.equal(secondRollback.idempotent, true, "rollback idempotent");
  });

  harness.test("MigrationExecutor: rollback refuses after activeStorage is marked switched", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await executor.execute({ envelope, preview, userConfirmed: true });
    const metadata = await target.get("migrationMetadata", metadataId(preview.migrationId));
    await target.put("migrationMetadata", { ...(metadata as MigrationExecutionMetadataRecord), activeStorageSwitched: true } as never);
    await expectStorageError(
      harness,
      () => executor.rollback({ migrationId: preview.migrationId }),
      "MIGRATION_ALREADY_ACTIVATED",
      "rollback after activation"
    );
  });

  harness.test("MigrationExecutor: rollback failure is checkpointed safely", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        beforeRollbackStore({ store }) {
          if (store === "savedItems") throw new Error("simulated rollback failure");
        }
      }
    });
    await executor.execute({ envelope, preview, userConfirmed: true });
    await expectStorageError(
      harness,
      () => executor.rollback({ migrationId: preview.migrationId }),
      "MIGRATION_ROLLBACK_FAILED",
      "rollback failure"
    );
    const metadata = await target.get("migrationMetadata", metadataId(preview.migrationId)) as MigrationExecutionMetadataRecord;
    harness.equal(metadata.executionStatus, "rollback_failed", "rollback failure metadata");
  });

  harness.test("MigrationExecutor: cancellation before execution writes no records", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const controller = new AbortController();
    controller.abort();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true, signal: controller.signal }),
      "MIGRATION_CANCELLED",
      "cancel before execution"
    );
    harness.equal((await target.getAll("savedItems")).length, 0, "cancelled before writes");
  });

  harness.test("MigrationExecutor: inspect reports resume and rollback availability", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        beforeStoreWrite({ store }) {
          if (store === "savedItems") throw new Error("stop before write");
        }
      }
    });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "inspect failed migration"
    );
    const inspection = await executor.inspect(preview.migrationId);
    harness.equal(inspection.found, true, "inspection found");
    harness.equal(inspection.canResume, true, "can resume");
    harness.equal(inspection.canRollback, true, "can rollback");
  });

  harness.test("MigrationExecutor: lock is released after execution failure", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const lockProvider = new MemoryMigrationLockProvider();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      lockProvider,
      faultInjector: {
        beforeStoreWrite() {
          throw new Error("fail early");
        }
      }
    });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "lock release failure"
    );
    harness.equal(lockProvider.isLocked(), false, "lock released after failure");
  });

  harness.test("MigrationExecutor: checksum comparison is stable regardless of object key order", () => {
    const first = [
      { ...makeSavedItem("saved-002"), userNote: "B" },
      { ...makeSavedItem("saved-001"), userNote: "A" }
    ];
    const second = [
      { ...makeSavedItem("saved-001"), userNote: "A" },
      { ...makeSavedItem("saved-002"), userNote: "B" }
    ];
    harness.equal(computeStoreChecksum("savedItems", first), computeStoreChecksum("savedItems", second), "stable checksum");
  });
}

export function getMigrationExecutorCaseCount(): number {
  return CASE_COUNT;
}

export function getMigrationExecutorCoveredStores(): readonly StorageEntityName[] {
  return ["savedItems", "importBatches", "importBatchItems", "smartAlbums", "actionCards", "planCards", "classificationCorrections", "searchLogs", "settings"];
}
