import {
  MigrationExecutionError,
  createLegacyBackupBlob,
  createLegacyBackupFilename,
  type MigrationExecutionInspection,
  type MigrationExecutionProgress,
  type MigrationExecutionResult,
  type MigrationStoreCheckpoint,
  type StorageAdapter,
  type StorageEntityName
} from "@revival/storage-service";
import { StorageBootstrapMarkerStore } from "@revival/storage-runtime";
import {
  MIGRATION_TARGET_DATABASE_NAME,
  MIGRATION_TARGET_SCHEMA_VERSION,
  createBrowserMigrationExecutionRuntime,
  type MigrationExecutionRuntime,
  type MigrationExecutorLike
} from "./migration-execution-runtime";
import {
  createBrowserIndexedDbDatabaseInspector,
  type IndexedDbDatabaseInspector
} from "./migration-database-inspector";

export type MigrationRecoveryUiDisposition =
  | "existing_session_not_found"
  | "resume_available"
  | "rollback_available"
  | "rollback_failed"
  | "rolled_back"
  | "completed_not_activated"
  | "recovery_blocked"
  | "another_session_running";

export type MigrationRecoveryLockStatus = "not_checked" | "available" | "held" | "unavailable";

export interface MigrationRecoveryInspectionResult {
  disposition: MigrationRecoveryUiDisposition;
  inspection?: MigrationExecutionInspection;
  allInspections: MigrationExecutionInspection[];
  lockStatus: MigrationRecoveryLockStatus;
  reason?: string;
}

export interface MigrationRecoveryLifecycleEvent {
  type: "opening_target" | "progress";
  progress?: MigrationExecutionProgress;
}

export interface MigrationRecoveryReport {
  formatVersion: 1;
  generatedAt: string;
  migrationId: string;
  executionId: string;
  status: string;
  sourceStorage: "localStorage";
  targetStorage: "indexedDB";
  activeStorage: "localStorage" | "indexedDB";
  activeStorageSwitched: boolean;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  rolledBackAt?: string;
  sourceCounts: Partial<Record<StorageEntityName, number>>;
  plannedCounts: Partial<Record<StorageEntityName, number>>;
  writtenCounts: Partial<Record<StorageEntityName, number>>;
  verifiedCounts: Partial<Record<StorageEntityName, number>>;
  checkpoints: Array<Pick<MigrationStoreCheckpoint, "store" | "status" | "expectedCount" | "writtenCount" | "verifiedCount" | "startedAt" | "completedAt" | "errorCode">>;
  backup: {
    status: string;
    createdAt?: string;
    byteLength?: number;
  };
  resumeCount: number;
  resumeAvailable: boolean;
  rollbackAvailable: boolean;
  warningCodes: string[];
  errorCode?: string;
}

export interface PreparedMigrationDownload {
  blob: Blob;
  filename: string;
}

export class MigrationRecoveryController {
  private abortController?: AbortController;
  private operationActive = false;
  private activeOperation?: "resume" | "rollback";
  private closeWarning?: string;

  constructor(
    private readonly executionRuntime: MigrationExecutionRuntime = createBrowserMigrationExecutionRuntime(),
    private readonly databaseInspector: IndexedDbDatabaseInspector = createBrowserIndexedDbDatabaseInspector()
  ) {}

  async inspectExistingSession(): Promise<MigrationRecoveryInspectionResult> {
    if (!this.databaseInspector.isSupported()) {
      return {
        disposition: "recovery_blocked",
        allInspections: [],
        lockStatus: "unavailable",
        reason: "当前浏览器无法自动检查上次升级状态，请使用最新版 Chrome 或 Edge。"
      };
    }
    if (!await this.databaseInspector.exists(MIGRATION_TARGET_DATABASE_NAME)) {
      return { disposition: "existing_session_not_found", allInspections: [], lockStatus: "not_checked" };
    }

    return this.withExecutor(async (executor) => {
      const inspections = await executor.inspectAll();
      if (inspections.length === 0) {
        return {
          disposition: "recovery_blocked",
          allInspections: [],
          lockStatus: "not_checked",
          reason: "检测到空的新存储，但没有升级记录。当前不会自动清理或继续。"
        };
      }
      const unresolved = inspections.filter((entry) => entry.status !== "rolled_back");
      if (unresolved.length > 1) {
        return {
          disposition: "recovery_blocked",
          allInspections: inspections,
          lockStatus: "not_checked",
          reason: "检测到多条尚未处理完成的升级记录，当前不能自动继续。"
        };
      }
      const inspection = unresolved[0] ?? inspections.at(-1)!;
      if (inspection.metadata?.activeStorageSwitched) {
        return {
          disposition: "recovery_blocked",
          inspection,
          allInspections: inspections,
          lockStatus: "not_checked",
          reason: "新存储已经被标记为启用，当前页面不会自动回滚。"
        };
      }
      const disposition = mapInspectionDisposition(inspection);
      if (!requiresWriterLockProbe(disposition)) {
        return { disposition, inspection, allInspections: inspections, lockStatus: "not_checked" };
      }
      const lockStatus = await this.probeWriterLock(inspection.migrationId);
      return {
        disposition: lockStatus === "held" ? "another_session_running" : lockStatus === "unavailable" ? "recovery_blocked" : disposition,
        inspection,
        allInspections: inspections,
        lockStatus,
        reason: lockStatus === "held"
          ? "另一个页面正在处理这次升级，请等待它完成后刷新状态。"
          : lockStatus === "unavailable"
            ? "当前浏览器无法取得安全升级锁，请使用最新版 Chrome 或 Edge。"
            : undefined
      };
    });
  }

  async resumeMigration(
    inspection: MigrationExecutionInspection,
    userConfirmed: boolean,
    onLifecycle?: (event: MigrationRecoveryLifecycleEvent) => void
  ): Promise<MigrationExecutionResult> {
    if (!userConfirmed || !inspection.canResume || inspection.backup.status !== "verified") {
      throw new MigrationExecutionError({
        code: "MIGRATION_USER_CONFIRMATION_REQUIRED",
        message: "Resume requires a verified backup and explicit user confirmation.",
        recoverable: true
      });
    }
    await this.assertActivationPrepareDoesNotBlock();
    this.assertRecoveryOperationReady(inspection);
    return this.runRecoveryOperation("resume", onLifecycle, async (executor, signal) =>
      executor.resume({ migrationId: inspection.migrationId, userConfirmed: true, signal })
    );
  }

  async rollbackMigration(
    inspection: MigrationExecutionInspection,
    confirmations: { clearNewStorage: boolean; recheckRequired: boolean },
    onLifecycle?: (event: MigrationRecoveryLifecycleEvent) => void
  ): Promise<MigrationExecutionResult> {
    if (!confirmations.clearNewStorage || !confirmations.recheckRequired || !inspection.canRollback) {
      throw new MigrationExecutionError({
        code: "MIGRATION_USER_CONFIRMATION_REQUIRED",
        message: "Rollback requires both explicit confirmations.",
        recoverable: true
      });
    }
    await this.assertActivationPrepareDoesNotBlock();
    this.assertRecoveryOperationReady(inspection);
    return this.runRecoveryOperation("rollback", onLifecycle, async (executor) =>
      executor.rollback({ migrationId: inspection.migrationId })
    );
  }

  private async assertActivationPrepareDoesNotBlock(): Promise<void> {
    if (typeof globalThis.localStorage === "undefined") return;
    const marker = await new StorageBootstrapMarkerStore(globalThis.localStorage).read();
    if (marker.status === "missing" || (marker.status === "valid" && marker.marker.state === "legacy_active")) return;
    throw new MigrationExecutionError({
      code: "MIGRATION_RESUME_CONFLICT",
      message: "Activation prepare must be cancelled before migration recovery can continue.",
      recoverable: true
    });
  }
  async prepareStoredBackupDownload(migrationId: string): Promise<PreparedMigrationDownload> {
    return this.withExecutor(async (executor) => {
      const backup = await executor.readPersistedBackup(migrationId);
      return {
        blob: createLegacyBackupBlob(backup.serializedEnvelope),
        filename: createLegacyBackupFilename(backup.envelope.createdAt)
      };
    });
  }

  createReport(inspection: MigrationExecutionInspection): MigrationRecoveryReport {
    const metadata = inspection.metadata;
    if (!metadata) throw new Error("Migration metadata is unavailable.");
    return {
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      migrationId: sanitizeIdentifier(inspection.migrationId),
      executionId: sanitizeIdentifier(metadata.id),
      status: metadata.executionStatus,
      sourceStorage: "localStorage",
      targetStorage: "indexedDB",
      activeStorage: metadata.activeStorageSwitched ? "indexedDB" : "localStorage",
      activeStorageSwitched: Boolean(metadata.activeStorageSwitched),
      startedAt: metadata.startedAt,
      completedAt: metadata.completedAt,
      failedAt: metadata.failedAt,
      rolledBackAt: metadata.rolledBackAt,
      sourceCounts: metadata.report?.sourceCounts ?? metadata.plan?.expectedSourceCounts ?? {},
      plannedCounts: metadata.report?.plannedCounts ?? metadata.plan?.expectedWriteCounts ?? {},
      writtenCounts: metadata.writtenCounts,
      verifiedCounts: metadata.verifiedCounts,
      checkpoints: metadata.checkpoints.map((checkpoint) => ({
        store: checkpoint.store,
        status: checkpoint.status,
        expectedCount: checkpoint.expectedCount,
        writtenCount: checkpoint.writtenCount,
        verifiedCount: checkpoint.verifiedCount,
        startedAt: checkpoint.startedAt,
        completedAt: checkpoint.completedAt,
        errorCode: checkpoint.errorCode
      })),
      backup: {
        status: inspection.backup.status,
        createdAt: inspection.backup.createdAt,
        byteLength: inspection.backup.byteLength
      },
      resumeCount: metadata.resumeCount,
      resumeAvailable: inspection.canResume,
      rollbackAvailable: inspection.canRollback,
      warningCodes: metadata.warnings.filter(isSafeCode),
      errorCode: typeof metadata.errorCode === "string" && isSafeCode(metadata.errorCode) ? metadata.errorCode : undefined
    };
  }

  prepareReportDownload(inspection: MigrationExecutionInspection): PreparedMigrationDownload {
    const report = this.createReport(inspection);
    const serialized = JSON.stringify(report, null, 2);
    return {
      blob: new Blob([serialized], { type: "application/json;charset=utf-8" }),
      filename: `collection-revival-migration-report-${safeDateStamp(report.generatedAt)}.json`
    };
  }

  requestResumeCancellation(): boolean {
    if (!this.operationActive || this.activeOperation !== "resume" || !this.abortController || this.abortController.signal.aborted) return false;
    this.abortController.abort();
    return true;
  }

  isOperationActive(): boolean {
    return this.operationActive;
  }

  getCloseWarning(): string | undefined {
    return this.closeWarning;
  }

  private async runRecoveryOperation(
    operation: "resume" | "rollback",
    onLifecycle: ((event: MigrationRecoveryLifecycleEvent) => void) | undefined,
    run: (executor: MigrationExecutorLike, signal: AbortSignal) => Promise<MigrationExecutionResult>
  ): Promise<MigrationExecutionResult> {
    if (this.operationActive) {
      throw new MigrationExecutionError({
        code: "MIGRATION_ACTIVE_SESSION_EXISTS",
        message: "A recovery operation is already active in this page.",
        recoverable: true
      });
    }
    if (!this.executionRuntime.isWebLocksAvailable()) {
      throw new MigrationExecutionError({
        code: "MIGRATION_LOCK_UNAVAILABLE",
        message: "Browser Web Locks are unavailable.",
        recoverable: true
      });
    }
    this.operationActive = true;
    this.activeOperation = operation;
    this.abortController = this.executionRuntime.createAbortController();
    this.closeWarning = undefined;
    try {
      onLifecycle?.({ type: "opening_target" });
      return await this.withExecutor(
        (executor) => run(executor, this.abortController!.signal),
        (progress) => onLifecycle?.({ type: "progress", progress }),
        true
      );
    } finally {
      this.operationActive = false;
      this.activeOperation = undefined;
      this.abortController = undefined;
    }
  }

  private async withExecutor<T>(
    operation: (executor: MigrationExecutorLike) => Promise<T>,
    onProgress?: (progress: MigrationExecutionProgress) => void,
    requireWriterLock = false
  ): Promise<T> {
    const adapter = this.executionRuntime.createTargetAdapter();
    try {
      if (!await adapter.isAvailable()) {
        throw new MigrationExecutionError({
          code: "MIGRATION_TARGET_UNAVAILABLE",
          message: "The new local storage is unavailable.",
          recoverable: true,
          adapter: adapter.kind
        });
      }
      await adapter.open();
      const lockProvider = requireWriterLock ? this.executionRuntime.createLockProvider() : undefined;
      if (requireWriterLock && (lockProvider?.kind !== "web-locks" || lockProvider.isAvailable?.() === false)) {
          throw new MigrationExecutionError({
            code: "MIGRATION_LOCK_UNAVAILABLE",
            message: "IndexedDB recovery requires Web Locks.",
            recoverable: true,
            adapter: adapter.kind
          });
        }
      const executor = this.executionRuntime.createExecutor({
        targetAdapter: adapter,
        lockProvider,
        expectedTargetSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION,
        onProgress
      });
      return await operation(executor);
    } finally {
      try {
        await adapter.close();
      } catch {
        this.closeWarning = "新存储连接关闭时出现提示，但不会覆盖本次操作结果。";
      }
    }
  }

  private async probeWriterLock(migrationId: string): Promise<MigrationRecoveryLockStatus> {
    if (!this.executionRuntime.isWebLocksAvailable()) return "unavailable";
    const provider = this.executionRuntime.createLockProvider();
    if (provider.kind !== "web-locks" || provider.isAvailable?.() === false) return "unavailable";
    try {
      const lock = await provider.acquire({ migrationId });
      await lock.release();
      return "available";
    } catch (error) {
      return error instanceof MigrationExecutionError && error.code === "MIGRATION_LOCK_UNAVAILABLE"
        ? "held"
        : "unavailable";
    }
  }

  private assertRecoveryOperationReady(inspection: MigrationExecutionInspection): void {
    if (inspection.metadata?.activeStorageSwitched) {
      throw new MigrationExecutionError({
        code: "MIGRATION_ALREADY_ACTIVATED",
        message: "Recovery is blocked after active storage has switched.",
        recoverable: false
      });
    }
  }
}

function mapInspectionDisposition(inspection: MigrationExecutionInspection): MigrationRecoveryUiDisposition {
  if (inspection.status === "completed") return "completed_not_activated";
  if (inspection.status === "rolled_back") return "rolled_back";
  if (inspection.status === "rollback_failed") return "rollback_failed";
  if (inspection.canResume) return "resume_available";
  if (inspection.canRollback) return "rollback_available";
  return "recovery_blocked";
}

function requiresWriterLockProbe(disposition: MigrationRecoveryUiDisposition): boolean {
  return disposition === "resume_available" || disposition === "rollback_available" || disposition === "rollback_failed";
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 72);
}

function isSafeCode(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value);
}

function safeDateStamp(value: string): string {
  const date = new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date(0) : date;
  return safe.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}
