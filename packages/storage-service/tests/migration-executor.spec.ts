import {
  IDBKeyRange as FakeIDBKeyRange,
  indexedDB as fakeIndexedDB
} from "fake-indexeddb";
import {
  MemoryMigrationLockProvider,
  WebLocksMigrationLockProvider,
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

const CASE_COUNT = 34;

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
      const executor = createMigrationExecutor({
        targetAdapter: target,
        lockProvider: createTestWebLocksProvider(),
        expectedTargetSchemaVersion: 1
      });
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
    const resumed = await executor.resume({ migrationId: preview.migrationId, userConfirmed: true });
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
      () => executor.resume({ migrationId: preview.migrationId, userConfirmed: true }),
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

  harness.test("MigrationExecutor: rollback_failed can be retried safely", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const failing = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        beforeRollbackStore({ store }) {
          if (store === "savedItems") throw new Error("simulated rollback failure");
        }
      }
    });
    await failing.execute({ envelope, preview, userConfirmed: true });
    await expectStorageError(
      harness,
      () => failing.rollback({ migrationId: preview.migrationId }),
      "MIGRATION_ROLLBACK_FAILED",
      "first rollback fails"
    );
    const retry = createMigrationExecutor({ targetAdapter: target });
    const result = await retry.rollback({ migrationId: preview.migrationId });
    harness.equal(result.status, "rolled_back", "retry rollback status");
    harness.equal((await target.getAll("savedItems")).length, 0, "savedItems cleared");
    harness.equal((await target.getAll("backups")).length, 1, "backup retained");
    harness.equal((await target.getAll("migrationMetadata")).length, 1, "metadata retained");
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

  harness.test("MigrationExecutor: inspectAll returns verified backup and persisted MigrationReport", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await executor.execute({ envelope, preview, userConfirmed: true });
    const inspections = await executor.inspectAll();
    harness.equal(inspections.length, 1, "one persisted inspection");
    harness.equal(inspections[0].backup.status, "verified", "persisted backup verified");
    harness.equal(inspections[0].report?.migrationId, preview.migrationId, "preview report persisted");
    harness.equal(inspections[0].result?.status, "completed", "completed result reconstructed");
  });

  harness.test("MigrationExecutor: persisted resume still requires explicit confirmation", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const failing = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: { beforeStoreWrite({ store }) { if (store === "savedItems") throw new Error("pause"); } }
    });
    await expectStorageError(harness, () => failing.execute({ envelope, preview, userConfirmed: true }), "MIGRATION_WRITE_FAILED", "seed failed migration");
    const retry = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => retry.resume({ migrationId: preview.migrationId, userConfirmed: false }),
      "MIGRATION_USER_CONFIRMATION_REQUIRED",
      "resume confirmation"
    );
  });

  harness.test("MigrationExecutor: stored backup can be independently verified and read", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target });
    await executor.execute({ envelope, preview, userConfirmed: true });
    const persisted = await executor.readPersistedBackup(preview.migrationId);
    harness.equal(persisted.envelope.backupId, envelope.backupId, "stored envelope id");
    harness.equal(persisted.migrationId, preview.migrationId, "stored migration id");
    harness.assert(persisted.serializedEnvelope.includes(envelope.backupId), "serialized backup retained");
  });

  harness.test("MigrationExecutor: tampered stored backup disables resume inspection", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const failing = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: { beforeStoreWrite({ store }) { if (store === "savedItems") throw new Error("pause"); } }
    });
    await expectStorageError(harness, () => failing.execute({ envelope, preview, userConfirmed: true }), "MIGRATION_WRITE_FAILED", "seed recoverable migration");
    const backup = await target.get("backups", "legacy-backup:legacy_backup_execution") as unknown as Record<string, unknown>;
    await target.put("backups", { ...backup, checksum: "a".repeat(64) } as never);
    const inspection = await createMigrationExecutor({ targetAdapter: target }).inspect(preview.migrationId);
    harness.equal(inspection.backup.status, "invalid", "tampered backup invalid");
    harness.equal(inspection.canResume, false, "tampered backup cannot resume");
  });

  harness.test("MigrationExecutor: backup read-back failure blocks business writes", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        async afterBackupWriteBeforeReadBack() {
          await target.delete("backups", "legacy-backup:legacy_backup_execution");
        }
      }
    });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_BACKUP_PERSIST_FAILED",
      "backup missing after write"
    );
    harness.equal((await target.getAll("savedItems")).length, 0, "no business store write");
  });

  harness.test("MigrationExecutor: backup checksum tampering blocks business writes", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        async afterBackupWriteBeforeReadBack() {
          const backup = await target.get("backups", "legacy-backup:legacy_backup_execution");
          await target.put("backups", { ...(backup as unknown as Record<string, unknown>), checksum: "0".repeat(64) } as never);
        }
      }
    });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_BACKUP_PERSIST_FAILED",
      "backup checksum tampered"
    );
    harness.equal((await target.getAll("savedItems")).length, 0, "no business store write");
  });

  harness.test("MigrationExecutor: same backup id and content is reused without overwrite", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const failing = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        beforeStoreWrite() {
          throw new Error("stop after verified backup");
        }
      }
    });
    await expectStorageError(
      harness,
      () => failing.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "first attempt stops before business write"
    );
    const before = await target.get("backups", "legacy-backup:legacy_backup_execution") as unknown as Record<string, unknown>;
    const retry = createMigrationExecutor({ targetAdapter: target });
    const result = await retry.execute({ envelope, preview, userConfirmed: true });
    const after = await target.get("backups", "legacy-backup:legacy_backup_execution") as unknown as Record<string, unknown>;
    harness.equal(result.status, "completed", "retry completed");
    harness.equal((await target.getAll("backups")).length, 1, "single backup record");
    harness.equal(after.createdAt, before.createdAt, "createdAt not overwritten");
    harness.equal(after.serializedEnvelope, before.serializedEnvelope, "serialized envelope not overwritten");
  });

  harness.test("MigrationExecutor: same backup id with different content is rejected", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const failing = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        beforeStoreWrite() {
          throw new Error("stop after backup");
        }
      }
    });
    await expectStorageError(
      harness,
      () => failing.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "first backup persisted"
    );
    const backup = await target.get("backups", "legacy-backup:legacy_backup_execution") as unknown as Record<string, unknown>;
    await target.put("backups", { ...backup, serializedEnvelope: `${String(backup.serializedEnvelope)}\n`, byteLength: Number(backup.byteLength) + 1 } as never);
    const retry = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => retry.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_RESUME_CONFLICT",
      "same backup id differs"
    );
    harness.equal((await target.getAll("savedItems")).length, 0, "still no business write");
  });

  harness.test("MigrationExecutor: target schema mismatch blocks before backup", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({ targetAdapter: target, expectedTargetSchemaVersion: 2 });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_TARGET_SCHEMA_MISMATCH",
      "schema mismatch"
    );
    harness.equal((await target.getAll("backups")).length, 0, "no backup write");
    harness.equal((await target.getAll("savedItems")).length, 0, "no business write");
  });

  harness.test("MigrationExecutor: other unresolved migration metadata blocks new execution", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    await target.put("migrationMetadata", {
      id: metadataId("other_migration"),
      sourceStorage: "localStorage",
      targetStorage: "indexedDB",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 1,
      status: "migrating",
      executionStatus: "writing_store",
      previewId: "other_migration",
      startedAt: "2026-07-15T00:00:00.000Z",
      activeStorageSwitched: false,
      rollbackAvailable: true,
      resumeCount: 0,
      checkpoints: [],
      writtenCounts: {},
      verifiedCounts: {},
      expectedChecksums: {},
      targetChecksums: {},
      warnings: []
    } as never);
    const executor = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_ACTIVE_SESSION_EXISTS",
      "other migration blocks"
    );
  });

  harness.test("MigrationExecutor: rolled back migration metadata does not block new execution", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    await target.put("migrationMetadata", {
      id: metadataId("rolled_back_migration"),
      sourceStorage: "localStorage",
      targetStorage: "indexedDB",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 1,
      status: "rolled_back",
      executionStatus: "rolled_back",
      startedAt: "2026-07-15T00:00:00.000Z",
      rolledBackAt: "2026-07-15T00:00:01.000Z",
      warnings: [],
      activeStorageSwitched: false,
      rollbackAvailable: false,
      resumeCount: 0,
      checkpoints: [],
      writtenCounts: {},
      verifiedCounts: {},
      expectedChecksums: {},
      targetChecksums: {},
      previewId: "rolled_back_migration"
    } as never);
    const executor = createMigrationExecutor({ targetAdapter: target });
    const result = await executor.execute({ envelope, preview, userConfirmed: true });
    harness.equal(result.status, "completed", "new migration allowed");
  });

  harness.test("MigrationExecutor: final semantic verification catches user field changes", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const executor = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        async mutateTargetBeforeFinalVerification() {
          await target.put("savedItems", makeSavedItem("saved-001", { userNote: "changed before final verification" }));
        }
      }
    });
    await expectStorageError(
      harness,
      () => executor.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_VERIFY_FAILED",
      "semantic verification"
    );
  });

  harness.test("MigrationExecutor: resume revalidates persisted backup", async () => {
    const { envelope, preview, target } = await createMigrationExecutionFixture();
    const failing = createMigrationExecutor({
      targetAdapter: target,
      faultInjector: {
        afterStoreWrite({ store }) {
          if (store === "savedItems") throw new Error("stop after savedItems");
        }
      }
    });
    await expectStorageError(
      harness,
      () => failing.execute({ envelope, preview, userConfirmed: true }),
      "MIGRATION_WRITE_FAILED",
      "partial migration"
    );
    const backup = await target.get("backups", "legacy-backup:legacy_backup_execution") as unknown as Record<string, unknown>;
    await target.put("backups", { ...backup, checksum: "f".repeat(64) } as never);
    const retry = createMigrationExecutor({ targetAdapter: target });
    await expectStorageError(
      harness,
      () => retry.resume({ migrationId: preview.migrationId, userConfirmed: true }),
      "MIGRATION_RESUME_CONFLICT",
      "resume backup tamper"
    );
  });

  harness.test("MigrationExecutor: IndexedDB execution requires Web Locks by default", async () => {
    const { envelope, preview } = await createMigrationExecutionFixture({ migrationId: "migration_indexeddb_lock_required" });
    const databaseName = `collection-revival-migration-lock-${Date.now()}`;
    const target = createIndexedDbAdapter({
      databaseName,
      indexedDBFactory: fakeIndexedDB,
      keyRangeFactory: FakeIDBKeyRange
    });
    try {
      const executor = createMigrationExecutor({ targetAdapter: target });
      await expectStorageError(
        harness,
        () => executor.execute({ envelope, preview, userConfirmed: true }),
        "MIGRATION_LOCK_UNAVAILABLE",
        "indexeddb memory lock blocked"
      );
    } finally {
      await target.close();
      await deleteIndexedDbDatabase(databaseName, fakeIndexedDB);
    }
  });

  harness.test("MigrationExecutor: Web Crypto unavailable blocks store checksum", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
      await expectStorageError(
        harness,
        () => computeStoreChecksum("savedItems", [makeSavedItem("saved-001")]),
        "MIGRATION_CRYPTO_UNAVAILABLE",
        "crypto unavailable"
      );
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    }
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

  harness.test("MigrationExecutor: checksum comparison is stable regardless of object key order", async () => {
    const first = [
      { ...makeSavedItem("saved-002"), userNote: "B" },
      { ...makeSavedItem("saved-001"), userNote: "A" }
    ];
    const second = [
      { ...makeSavedItem("saved-001"), userNote: "A" },
      { ...makeSavedItem("saved-002"), userNote: "B" }
    ];
    const checksum = await computeStoreChecksum("savedItems", first);
    harness.equal(checksum.length, 64, "sha-256 hex length");
    harness.equal(checksum, await computeStoreChecksum("savedItems", second), "stable checksum");
    harness.assert(checksum !== await computeStoreChecksum("actionCards" as never, second as never), "store name participates");
  });
}

export function getMigrationExecutorCaseCount(): number {
  return CASE_COUNT;
}

export function getMigrationExecutorCoveredStores(): readonly StorageEntityName[] {
  return ["savedItems", "importBatches", "importBatchItems", "smartAlbums", "actionCards", "planCards", "classificationCorrections", "searchLogs", "settings"];
}

function createTestWebLocksProvider(): WebLocksMigrationLockProvider {
  let held = false;
  return new WebLocksMigrationLockProvider({
    async request<T>(_name: string, _options: unknown, callback: (lock: unknown | null) => T | Promise<T>): Promise<T> {
      if (held) return callback(null);
      held = true;
      try {
        return await callback({ name: "test-lock" });
      } finally {
        held = false;
      }
    }
  });
}
