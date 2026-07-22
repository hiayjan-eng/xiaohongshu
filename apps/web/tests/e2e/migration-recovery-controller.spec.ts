import { expect, test } from "@playwright/test";
import {
  MigrationExecutionError,
  createMemoryAdapter,
  type LegacyBackupEnvelope,
  type MigrationExecutionInspection,
  type MigrationExecutionMetadataRecord,
  type MigrationExecutionOptions,
  type MigrationExecutionProgress,
  type MigrationExecutionResult,
  type MigrationLockProvider,
  type PersistedMigrationBackup,
  type StorageAdapter
} from "@revival/storage-service";
import {
  MigrationRecoveryController,
  type MigrationRecoveryInspectionResult
} from "../../src/features/storage-migration/migration-recovery-controller";
import type { IndexedDbDatabaseInspector } from "../../src/features/storage-migration/migration-database-inspector";
import type { MigrationExecutionRuntime, MigrationExecutorLike } from "../../src/features/storage-migration/migration-execution-runtime";
import { initialMigrationPreviewUiState, migrationPreviewReducer } from "../../src/features/storage-migration/migration-preview-reducer";

interface RecoveryRuntimeControl {
  runtime: MigrationExecutionRuntime;
  target: StorageAdapter;
  createTargetCalls: number;
  createLockCalls: number;
  inspectCalls: number;
  resumeCalls: number;
  rollbackCalls: number;
  executeCalls: number;
  readBackupCalls: number;
  capturedOptions?: MigrationExecutionOptions;
}

function createInspector(options: { supported?: boolean; exists?: boolean } = {}): IndexedDbDatabaseInspector {
  return {
    isSupported: () => options.supported ?? true,
    exists: async () => options.exists ?? true
  };
}

function createRuntime(options: {
  inspections?: MigrationExecutionInspection[];
  locksAvailable?: boolean;
  lockHeld?: boolean;
  resumeResult?: MigrationExecutionResult;
  rollbackResult?: MigrationExecutionResult;
  resumeError?: unknown;
  rollbackError?: unknown;
} = {}): RecoveryRuntimeControl {
  const target = createMemoryAdapter({ schemaVersion: 1 });
  const control: RecoveryRuntimeControl = {
    target,
    createTargetCalls: 0,
    createLockCalls: 0,
    inspectCalls: 0,
    resumeCalls: 0,
    rollbackCalls: 0,
    executeCalls: 0,
    readBackupCalls: 0,
    runtime: undefined as never
  };
  const executor: MigrationExecutorLike = {
    execute: async () => { control.executeCalls += 1; return makeResult("completed"); },
    inspectAll: async () => { control.inspectCalls += 1; return options.inspections ?? [makeInspection("cancelled")]; },
    resume: async (input) => {
      control.resumeCalls += 1;
      if (options.resumeError) throw options.resumeError;
      control.capturedOptions?.onProgress?.(makeProgress(input.migrationId, "writing_store"));
      return options.resumeResult ?? makeResult("completed");
    },
    rollback: async (input) => {
      control.rollbackCalls += 1;
      if (options.rollbackError) throw options.rollbackError;
      control.capturedOptions?.onProgress?.(makeProgress(input.migrationId, "rollback_pending"));
      return options.rollbackResult ?? makeResult("rolled_back");
    },
    readPersistedBackup: async (migrationId) => {
      control.readBackupCalls += 1;
      return makePersistedBackup(migrationId);
    }
  };
  control.runtime = {
    isWebLocksAvailable: () => options.locksAvailable ?? true,
    createTargetAdapter: () => { control.createTargetCalls += 1; return target; },
    createLockProvider: () => {
      control.createLockCalls += 1;
      return createLockProvider(Boolean(options.lockHeld));
    },
    createExecutor: (executionOptions) => { control.capturedOptions = executionOptions; return executor; },
    createAbortController: () => new AbortController()
  };
  return control;
}

test.describe("Task 7C recovery controller", () => {
  test("unsupported database enumeration and missing database never create or open an Adapter", async () => {
    const unsupported = createRuntime();
    const unsupportedResult = await new MigrationRecoveryController(unsupported.runtime, createInspector({ supported: false })).inspectExistingSession();
    expect(unsupportedResult).toMatchObject({ disposition: "recovery_blocked", lockStatus: "unavailable" });
    expect(unsupported.createTargetCalls).toBe(0);

    const missing = createRuntime();
    const missingResult = await new MigrationRecoveryController(missing.runtime, createInspector({ exists: false })).inspectExistingSession();
    expect(missingResult.disposition).toBe("existing_session_not_found");
    expect(missing.createTargetCalls).toBe(0);
    expect(missing.inspectCalls).toBe(0);
  });

  test("an existing database is inspected read-only and the Adapter closes", async () => {
    const control = createRuntime();
    const result = await new MigrationRecoveryController(control.runtime, createInspector()).inspectExistingSession();
    expect(result.disposition).toBe("resume_available");
    expect(control.createTargetCalls).toBe(1);
    expect(control.inspectCalls).toBe(1);
    expect(control.resumeCalls).toBe(0);
    expect(control.rollbackCalls).toBe(0);
    await expect(control.target.getAll("migrationMetadata")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  test("completed, failed, rollback_failed, and rolled_back map from inspection capabilities", async () => {
    await expectDisposition(makeInspection("completed"), "completed_not_activated");
    await expectDisposition(makeInspection("failed", { canResume: false, canRollback: true }), "rollback_available");
    await expectDisposition(makeInspection("rollback_failed", { canResume: false, canRollback: true }), "rollback_failed");
    await expectDisposition(makeInspection("rolled_back", { canResume: false, canRollback: false }), "rolled_back");
  });

  test("multiple unresolved migrations and activeStorageSwitched block recovery", async () => {
    const multiple = createRuntime({ inspections: [makeInspection("cancelled"), makeInspection("failed", { migrationId: "migration-2" })] });
    expect((await new MigrationRecoveryController(multiple.runtime, createInspector()).inspectExistingSession()).disposition).toBe("recovery_blocked");

    const activated = makeInspection("completed");
    activated.metadata = { ...activated.metadata!, activeStorageSwitched: true } as MigrationExecutionMetadataRecord;
    const control = createRuntime({ inspections: [activated] });
    const result = await new MigrationRecoveryController(control.runtime, createInspector()).inspectExistingSession();
    expect(result).toMatchObject({ disposition: "recovery_blocked" });
    expect(result.reason).toContain("标记为启用");
  });

  test("a held writer lock maps to another_session_running without fallback", async () => {
    const control = createRuntime({ lockHeld: true });
    const result = await new MigrationRecoveryController(control.runtime, createInspector()).inspectExistingSession();
    expect(result).toMatchObject({ disposition: "another_session_running", lockStatus: "held" });
    expect(control.resumeCalls).toBe(0);
    expect(control.rollbackCalls).toBe(0);
  });

  test("resume requires confirmation, uses Web Locks, never calls execute, and closes", async () => {
    const control = createRuntime();
    const controller = new MigrationRecoveryController(control.runtime, createInspector());
    const inspection = makeInspection("cancelled");
    await expect(controller.resumeMigration(inspection, false)).rejects.toMatchObject({ code: "MIGRATION_USER_CONFIRMATION_REQUIRED" });
    const events: string[] = [];
    const result = await controller.resumeMigration(inspection, true, (event) => events.push(event.type));
    expect(result.status).toBe("completed");
    expect(control.resumeCalls).toBe(1);
    expect(control.executeCalls).toBe(0);
    expect(control.createLockCalls).toBe(1);
    expect(control.capturedOptions?.lockProvider?.kind).toBe("web-locks");
    expect(control.capturedOptions?.unsafeAllowProcessLocalLockForTests).toBeUndefined();
    expect(events).toEqual(["opening_target", "progress"]);
    await expect(control.target.getAll("savedItems")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  test("rollback requires two confirmations, retains evidence contract, and can retry", async () => {
    const failure = new MigrationExecutionError({ code: "MIGRATION_ROLLBACK_FAILED", message: "test rollback failure", recoverable: true });
    const failing = createRuntime({ rollbackError: failure });
    const inspection = makeInspection("rollback_failed", { canResume: false, canRollback: true });
    const controller = new MigrationRecoveryController(failing.runtime, createInspector());
    await expect(controller.rollbackMigration(inspection, { clearNewStorage: true, recheckRequired: false })).rejects.toMatchObject({ code: "MIGRATION_USER_CONFIRMATION_REQUIRED" });
    await expect(controller.rollbackMigration(inspection, { clearNewStorage: true, recheckRequired: true })).rejects.toMatchObject({ code: "MIGRATION_ROLLBACK_FAILED" });
    expect(failing.rollbackCalls).toBe(1);

    const retry = createRuntime({ rollbackResult: makeResult("rolled_back") });
    const result = await new MigrationRecoveryController(retry.runtime, createInspector()).rollbackMigration(inspection, { clearNewStorage: true, recheckRequired: true });
    expect(result.status).toBe("rolled_back");
    expect(retry.executeCalls).toBe(0);
  });

  test("stored backup and migration report downloads are JSON-safe and omit user content", async () => {
    const control = createRuntime();
    const controller = new MigrationRecoveryController(control.runtime, createInspector());
    const backup = await controller.prepareStoredBackupDownload("migration-1");
    expect(backup.filename).toMatch(/^collection-revival-backup-/);
    expect(backup.blob.type).toContain("application/json");
    const report = controller.createReport(makeInspection("cancelled"));
    expect(report.executionId).toMatch(/^migration-execution:/);
    expect(report).toMatchObject({ activeStorage: "localStorage", activeStorageSwitched: false, resumeAvailable: true });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("userNote");
    expect(serialized).not.toContain("xsec_token");
    expect(serialized).not.toContain("serializedEnvelope");
    expect(serialized).not.toContain("expectedChecksum");
    expect(controller.prepareReportDownload(makeInspection("cancelled")).filename).toContain("migration-report");
  });

  test("resume cancellation is explicit and rollback cannot be cancelled through the resume control", async () => {
    let release!: () => void;
    const waiting = new Promise<MigrationExecutionResult>((resolve) => { release = () => resolve(makeResult("completed")); });
    const control = createRuntime({ resumeResult: awaitable(waiting) });
    const controller = new MigrationRecoveryController(control.runtime, createInspector());
    const operation = controller.resumeMigration(makeInspection("cancelled"), true);
    await expect.poll(() => controller.isOperationActive()).toBe(true);
    expect(controller.requestResumeCancellation()).toBe(true);
    release();
    await operation;
    expect(controller.requestResumeCancellation()).toBe(false);
  });

  test("reducer models recovery inspection, confirmations, progress, retry, and report without contradictory flags", () => {
    const recovery = makeRecovery("resume_available");
    let state = migrationPreviewReducer(initialMigrationPreviewUiState, { type: "CHECK_EXISTING_SESSION" });
    expect(state.status).toBe("checking_existing_session");
    state = migrationPreviewReducer(state, { type: "EXISTING_SESSION_RESOLVED", recovery });
    expect(state).toMatchObject({ status: "resume_available", resumeConfirmed: false, reportExpanded: false });
    state = migrationPreviewReducer(state, { type: "SELECT_RECOVERY_ACTION", action: "resume" });
    state = migrationPreviewReducer(state, { type: "SET_RESUME_CONFIRMATION", value: true });
    state = migrationPreviewReducer(state, { type: "START_RESUME" });
    state = migrationPreviewReducer(state, { type: "RECOVERY_PROGRESS", progress: makeProgress("migration-1", "writing_store") });
    expect(state).toMatchObject({ status: "resuming", canCancel: true });
    state = migrationPreviewReducer(state, { type: "TOGGLE_REPORT" });
    expect(state.reportExpanded).toBe(true);
  });
});

async function expectDisposition(inspection: MigrationExecutionInspection, expected: MigrationRecoveryInspectionResult["disposition"]) {
  const control = createRuntime({ inspections: [inspection] });
  expect((await new MigrationRecoveryController(control.runtime, createInspector()).inspectExistingSession()).disposition).toBe(expected);
}

function createLockProvider(held: boolean): MigrationLockProvider {
  return {
    kind: "web-locks",
    isAvailable: () => true,
    async acquire({ migrationId, name = "collection-revival:migration-writer" }) {
      if (held) throw new MigrationExecutionError({ code: "MIGRATION_LOCK_UNAVAILABLE", message: "held", recoverable: true });
      return { name, migrationId, acquiredAt: new Date(0).toISOString(), release: async () => undefined };
    }
  };
}

function makeInspection(
  status: MigrationExecutionMetadataRecord["executionStatus"],
  overrides: { migrationId?: string; canResume?: boolean; canRollback?: boolean } = {}
): MigrationExecutionInspection {
  const migrationId = overrides.migrationId ?? "migration-1";
  const checkpoint = { store: "savedItems" as const, status: status === "rolled_back" ? "rolled_back" as const : "verified" as const, expectedCount: 1, writtenCount: 1, verifiedCount: 1 };
  const metadata: MigrationExecutionMetadataRecord = {
    id: `migration-execution:${migrationId}`,
    sourceStorage: "localStorage",
    targetStorage: "indexedDB",
    sourceSchemaVersion: 1,
    targetSchemaVersion: 1,
    status: status === "completed" ? "completed" : status === "rolled_back" ? "rolled_back" : "failed",
    executionStatus: status,
    previewId: migrationId,
    startedAt: "2026-07-17T08:00:00.000Z",
    backupId: "backup-1",
    backupRecordId: "legacy-backup:backup-1",
    backupChecksum: "a".repeat(64),
    backupByteLength: 100,
    sourceSnapshotChecksum: "b".repeat(64),
    activeStorageSwitched: false,
    rollbackAvailable: status !== "rolled_back",
    resumeCount: 1,
    checkpoints: [checkpoint],
    writtenCounts: { savedItems: 1 },
    verifiedCounts: { savedItems: 1 },
    expectedChecksums: { savedItems: "c".repeat(64) },
    targetChecksums: { savedItems: "c".repeat(64) },
    warnings: []
  };
  return {
    found: true,
    migrationId,
    metadata,
    checkpoints: metadata.checkpoints,
    canResume: overrides.canResume ?? status === "cancelled",
    canRollback: overrides.canRollback ?? status !== "rolled_back",
    status,
    backup: { status: "verified", recordId: metadata.backupRecordId, backupId: metadata.backupId, createdAt: metadata.startedAt, byteLength: 100, verifiedAt: metadata.startedAt },
    result: status === "completed" || status === "rolled_back" ? makeResult(status) : undefined
  };
}

function makeRecovery(disposition: MigrationRecoveryInspectionResult["disposition"]): MigrationRecoveryInspectionResult {
  return { disposition, inspection: makeInspection("cancelled"), allInspections: [makeInspection("cancelled")], lockStatus: "available" };
}

function makeResult(status: MigrationExecutionResult["status"]): MigrationExecutionResult {
  return {
    migrationId: "migration-1",
    status,
    targetStorage: "indexedDB",
    startedAt: "2026-07-17T08:00:00.000Z",
    backupId: "backup-1",
    checkpoints: [],
    writtenCounts: {},
    verifiedCounts: {},
    expectedChecksums: {},
    targetChecksums: {},
    rollbackAvailable: status !== "rolled_back",
    activeStorageSwitched: false,
    resumed: status === "completed",
    resumeCount: 1,
    idempotent: false,
    warnings: []
  };
}

function makeProgress(migrationId: string, status: MigrationExecutionProgress["status"]): MigrationExecutionProgress {
  return { migrationId, status, currentStore: "savedItems", completedStores: 1, totalStores: 2, writtenCounts: { savedItems: 1 }, verifiedCounts: { savedItems: 1 }, updatedAt: "2026-07-17T08:01:00.000Z" };
}

function makePersistedBackup(migrationId: string): PersistedMigrationBackup {
  const envelope = { formatVersion: 1, backupId: "backup-1", createdAt: "2026-07-17T08:00:00.000Z", source: "legacy-localStorage" } as LegacyBackupEnvelope;
  return { migrationId, recordId: "legacy-backup:backup-1", serializedEnvelope: JSON.stringify(envelope), envelope, byteLength: 100, checksum: "a".repeat(64), verifiedAt: envelope.createdAt };
}

function awaitable(value: Promise<MigrationExecutionResult>): MigrationExecutionResult {
  return value as unknown as MigrationExecutionResult;
}
