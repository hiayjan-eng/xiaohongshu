import { expect, test } from "@playwright/test";
import {
  LEGACY_ACHIEVEMENT_STORAGE_KEY,
  LEGACY_APP_STATE_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  MigrationExecutionError,
  createMemoryAdapter,
  type MigrationExecutionOptions,
  type MigrationExecutionProgress,
  type MigrationExecutionResult,
  type MigrationLockProvider,
  type ReadonlyStorageLike,
  type StorageAdapter,
  type StorageEntityName
} from "@revival/storage-service";
import {
  MigrationFlowController,
  type MigrationControllerLifecycleEvent
} from "../../src/features/storage-migration/migration-flow-controller";
import type { MigrationExecutionRuntime } from "../../src/features/storage-migration/migration-execution-runtime";
import { calculateMigrationPercent } from "../../src/features/storage-migration/MigrationExecutionStep";
import { initialMigrationPreviewUiState, migrationPreviewReducer } from "../../src/features/storage-migration/migration-preview-reducer";
import { makeMigrationAppState } from "./migration-preview-fixtures";

class FakeReadonlyStorage implements ReadonlyStorageLike {
  readonly reads: string[] = [];
  private readonly keys: string[];

  constructor(private readonly records: Record<string, string | null>) {
    this.keys = Object.keys(records);
  }

  get length() {
    return this.keys.length;
  }

  getItem(key: string) {
    this.reads.push(key);
    return this.records[key] ?? null;
  }

  key(index: number) {
    return this.keys[index] ?? null;
  }
}

interface FakeRuntimeControl {
  runtime: MigrationExecutionRuntime;
  target: StorageAdapter;
  createTargetCalls: number;
  createLockCalls: number;
  executeCalls: number;
  capturedOptions?: MigrationExecutionOptions;
}

function createStorage() {
  return new FakeReadonlyStorage({
    [LEGACY_APP_STATE_STORAGE_KEY]: JSON.stringify(makeMigrationAppState()),
    [LEGACY_THEME_STORAGE_KEY]: "lavender-mint",
    [LEGACY_ACHIEVEMENT_STORAGE_KEY]: JSON.stringify({ first_revival: "2026-07-16T08:00:00.000Z" })
  });
}

function createWebLockProvider(): MigrationLockProvider {
  return {
    kind: "web-locks",
    isAvailable: () => true,
    async acquire({ migrationId, name = "test-lock" }) {
      return {
        name,
        migrationId,
        acquiredAt: new Date(0).toISOString(),
        release: async () => undefined
      };
    }
  };
}

function createFakeRuntime(options: {
  locksAvailable?: boolean;
  execute?: (executionOptions: MigrationExecutionOptions, signal?: AbortSignal) => Promise<MigrationExecutionResult>;
} = {}): FakeRuntimeControl {
  const target = createMemoryAdapter({ schemaVersion: 1 });
  const control: FakeRuntimeControl = {
    target,
    createTargetCalls: 0,
    createLockCalls: 0,
    executeCalls: 0,
    runtime: undefined as never
  };
  control.runtime = {
    isWebLocksAvailable: () => options.locksAvailable ?? true,
    createTargetAdapter: () => {
      control.createTargetCalls += 1;
      return target;
    },
    createLockProvider: () => {
      control.createLockCalls += 1;
      return createWebLockProvider();
    },
    createExecutor: (executionOptions) => {
      control.capturedOptions = executionOptions;
      return {
        execute: async (input) => {
          control.executeCalls += 1;
          if (options.execute) return options.execute(executionOptions, input.signal);
          const progress = makeProgress(input.preview.plan.migrationId, "verifying_all", 9, 9);
          executionOptions.onProgress?.(progress);
          return makeCompletedResult(input.preview.plan.migrationId, input.envelope.backupId, input.preview.plan.requiredStores);
        }
      };
    },
    createAbortController: () => new AbortController()
  };
  return control;
}

async function prepareReadyController(control = createFakeRuntime()) {
  const controller = new MigrationFlowController(createStorage(), control.runtime);
  await controller.inspect();
  controller.prepareBackupDownload();
  controller.markBackupDownloadTriggered();
  controller.setConfirmation("legacyDataRetained", true);
  controller.setConfirmation("backupDownloaded", true);
  controller.setConfirmation("legacyStorageStillActive", true);
  controller.setConfirmation("activationRequiresNextPhase", true);
  return { controller, control };
}

test.describe("Task 7B migration execution controller", () => {
  test("inspection and backup stay read-only and do not create the target Adapter", async () => {
    const control = createFakeRuntime();
    const storage = createStorage();
    const controller = new MigrationFlowController(storage, control.runtime);
    expect(control.createTargetCalls).toBe(0);
    await controller.inspect();
    controller.prepareBackupDownload();
    controller.markBackupDownloadTriggered();
    expect(control.createTargetCalls).toBe(0);
    expect(control.createLockCalls).toBe(0);
    expect(storage.reads.length).toBeGreaterThan(0);
  });

  test("execution remains blocked until backup download and all confirmations", async () => {
    const control = createFakeRuntime();
    const controller = new MigrationFlowController(createStorage(), control.runtime);
    await controller.inspect();
    expect(controller.canEnterConfirmation().ready).toBe(false);
    controller.markBackupDownloadTriggered();
    expect(controller.canEnterConfirmation().ready).toBe(true);
    expect(controller.canStartExecution()).toEqual({ ready: false, reason: "请完成四项确认后再开始升级。" });
    for (const key of ["legacyDataRetained", "backupDownloaded", "legacyStorageStillActive", "activationRequiresNextPhase"] as const) {
      controller.setConfirmation(key, true);
    }
    expect(controller.canStartExecution()).toEqual({ ready: true });
    expect(control.createTargetCalls).toBe(0);
  });

  test("missing Web Locks stops before IndexedDB creation", async () => {
    const { controller, control } = await prepareReadyController(createFakeRuntime({ locksAvailable: false }));
    await expect(controller.startExecution()).rejects.toMatchObject({ code: "MIGRATION_LOCK_UNAVAILABLE" });
    expect(control.createTargetCalls).toBe(0);
    expect(control.createLockCalls).toBe(0);
    expect(control.executeCalls).toBe(0);
  });

  test("confirmed execution opens the target, reports real progress, and closes without activation", async () => {
    const { controller, control } = await prepareReadyController();
    const events: MigrationControllerLifecycleEvent[] = [];
    const outcome = await controller.startExecution((event) => events.push(event));
    expect(outcome.result.status).toBe("completed");
    expect(outcome.result.activeStorageSwitched).toBe(false);
    expect(control.createTargetCalls).toBe(1);
    expect(control.createLockCalls).toBe(1);
    expect(control.executeCalls).toBe(1);
    expect(control.capturedOptions?.expectedTargetSchemaVersion).toBe(1);
    expect(control.capturedOptions?.unsafeAllowProcessLocalLockForTests).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(["checking_execution_support", "opening_target", "progress"]);
    await expect(control.target.getAll("savedItems")).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  test("safe stop aborts the active execution and never creates an activation result", async () => {
    let executionStarted!: () => void;
    const started = new Promise<void>((resolve) => { executionStarted = resolve; });
    const control = createFakeRuntime({
      execute: async (_executionOptions, signal) => {
        executionStarted();
        await new Promise<void>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new MigrationExecutionError({
            code: "MIGRATION_CANCELLED",
            message: "Cancelled by the test user.",
            recoverable: true
          })), { once: true });
        });
        throw new Error("unreachable");
      }
    });
    const { controller } = await prepareReadyController(control);
    const execution = controller.startExecution();
    await started;
    expect(controller.isExecutionActive()).toBe(true);
    expect(controller.requestCancellation()).toBe(true);
    await expect(execution).rejects.toMatchObject({ code: "MIGRATION_CANCELLED" });
    expect(controller.isExecutionActive()).toBe(false);
    expect(controller.requestCancellation()).toBe(false);
  });

  test("reducer covers confirmation, execution, cancelling, completion, and failure without conflicting flags", () => {
    const confirmation = { ...initialMigrationPreviewUiState, status: "awaiting_confirmation" as const, currentStep: 4 as const };
    const checked = migrationPreviewReducer(confirmation, { type: "SET_CONFIRMATION", key: "backupDownloaded", value: true });
    expect(checked.confirmationValues.backupDownloaded).toBe(true);
    const opening = migrationPreviewReducer(checked, { type: "CHECK_EXECUTION_SUPPORT" });
    expect(opening.status).toBe("checking_execution_support");
    const target = migrationPreviewReducer(opening, { type: "OPENING_TARGET" });
    expect(target).toMatchObject({ status: "opening_target", canCancel: true, cancelDialogOpen: false });
    const cancelling = migrationPreviewReducer(target, { type: "CANCELLING" });
    expect(cancelling).toMatchObject({ status: "cancelling", canCancel: false, cancelDialogOpen: false });
    const failed = migrationPreviewReducer(cancelling, {
      type: "EXECUTION_FAILED",
      error: { code: "MIGRATION_WRITE_FAILED", message: "升级没有完成。" }
    });
    expect(failed).toMatchObject({ status: "execution_failed", canCancel: false, technicalErrorCode: "MIGRATION_WRITE_FAILED" });
  });

  test("progress percentage uses execution checkpoints rather than a timer", () => {
    expect(calculateMigrationPercent("checking_execution_support")).toBe(1);
    expect(calculateMigrationPercent("opening_target")).toBe(2);
    expect(calculateMigrationPercent("executing", makeProgress("migration-1", "writing_store", 3, 9))).toBe(35);
    expect(calculateMigrationPercent("verifying", makeProgress("migration-1", "verifying_all", 9, 9))).toBe(95);
    expect(calculateMigrationPercent("completed_not_activated")).toBe(100);
  });
});

function makeProgress(
  migrationId: string,
  status: MigrationExecutionProgress["status"],
  completedStores: number,
  totalStores: number
): MigrationExecutionProgress {
  return {
    migrationId,
    status,
    completedStores,
    totalStores,
    writtenCounts: {},
    verifiedCounts: {},
    updatedAt: "2026-07-16T08:00:00.000Z"
  };
}

function makeCompletedResult(
  migrationId: string,
  backupId: string,
  stores: readonly StorageEntityName[]
): MigrationExecutionResult {
  return {
    migrationId,
    status: "completed",
    targetStorage: "indexedDB",
    startedAt: "2026-07-16T08:00:00.000Z",
    completedAt: "2026-07-16T08:01:00.000Z",
    backupId,
    checkpoints: stores.map((store) => ({
      store,
      status: "verified",
      expectedCount: 0,
      writtenCount: 0,
      verifiedCount: 0
    })),
    writtenCounts: {},
    verifiedCounts: {},
    expectedChecksums: {},
    targetChecksums: {},
    rollbackAvailable: true,
    activeStorageSwitched: false,
    resumed: false,
    resumeCount: 0,
    idempotent: false,
    warnings: []
  };
}
