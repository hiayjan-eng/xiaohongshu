import {
  LEGACY_APP_STATE_STORAGE_KEY,
  LegacyLocalStorageSnapshotReader,
  MigrationExecutionError,
  createLegacyBackupBlob,
  createLegacyBackupFilename,
  createMigrationPreview,
  createMigrationPreviewUserSummary,
  serializeLegacyBackup,
  validateMigrationSource,
  type LegacyBackupEnvelope,
  type MigrationExecutionProgress,
  type MigrationExecutionResult,
  type ReadonlyStorageLike,
  type StorageAdapter
} from "@revival/storage-service";
import {
  MIGRATION_TARGET_SCHEMA_VERSION,
  createBrowserMigrationExecutionRuntime,
  type MigrationExecutionRuntime
} from "./migration-execution-runtime";
import {
  EMPTY_MIGRATION_CONFIRMATIONS,
  type MigrationConfirmationKey,
  type MigrationConfirmationValues,
  type MigrationExecutionReadiness,
  type MigrationInspectionDisposition,
  type MigrationInspectionProgress,
  type MigrationInspectionResult,
  type PreparedLegacyBackupDownload
} from "./migration-preview-types";

const PRODUCT_DATA_STORES = [
  "savedItems",
  "importBatches",
  "importBatchItems",
  "smartAlbums",
  "actionCards",
  "planCards",
  "classificationCorrections"
] as const;

export const MIGRATION_INSPECTION_PROGRESS: readonly MigrationInspectionProgress[] = [
  { stage: "reading_local_data", label: "正在读取本地收藏" },
  { stage: "creating_raw_backup", label: "正在生成原始备份" },
  { stage: "validating_structure", label: "正在检查数据结构" },
  { stage: "checking_preserved_data", label: "正在核对用户备注和分类" },
  { stage: "creating_preview", label: "正在生成升级预览" }
] as const;

export type MigrationControllerLifecycleEvent =
  | { type: "checking_execution_support" }
  | { type: "opening_target" }
  | { type: "progress"; progress: MigrationExecutionProgress };

export interface MigrationExecutionOutcome {
  result: MigrationExecutionResult;
  closeWarning?: string;
}

export class MigrationFlowController {
  private currentResult?: MigrationInspectionResult;
  private backupDownloadTriggered = false;
  private confirmations: MigrationConfirmationValues = { ...EMPTY_MIGRATION_CONFIRMATIONS };
  private abortController?: AbortController;
  private targetAdapter?: StorageAdapter;
  private executionActive = false;
  private closeWarning?: string;

  constructor(
    private readonly storage: ReadonlyStorageLike,
    private readonly executionRuntime: MigrationExecutionRuntime = createBrowserMigrationExecutionRuntime()
  ) {}

  async inspect(onProgress?: (progress: MigrationInspectionProgress) => void): Promise<MigrationInspectionResult> {
    this.backupDownloadTriggered = false;
    this.confirmations = { ...EMPTY_MIGRATION_CONFIRMATIONS };
    onProgress?.(MIGRATION_INSPECTION_PROGRESS[0]);
    const reader = new LegacyLocalStorageSnapshotReader(this.storage);

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[1]);
    const envelope = await reader.createBackupEnvelope({
      appVersion: "web-task7b",
      notes: "User-initiated migration inspection and confirmation"
    });

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[2]);
    const sourceValidation = await validateMigrationSource(envelope, {
      targetSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION
    });

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[3]);
    const preview = await createMigrationPreview(envelope, {
      targetSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION,
      targetMustBeEmpty: true
    });

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[4]);
    const userSummary = createMigrationPreviewUserSummary(preview);
    const hasProductData = hasLegacyProductData(envelope);
    const disposition = getInspectionDisposition(
      envelope,
      preview.summary.totalBlockingIssues,
      preview.summary.totalWarnings,
      preview.summary.totalManualReview,
      hasProductData
    );
    const result: MigrationInspectionResult = {
      disposition,
      envelope,
      sourceValidation,
      preview,
      plan: preview.plan,
      userSummary,
      rawBackupAvailable: envelope.report.canExportRawBackup,
      hasProductData
    };
    this.currentResult = result;
    return result;
  }

  getCurrentResult(): MigrationInspectionResult | undefined {
    return this.currentResult;
  }

  serializeBackup(): string {
    return serializeLegacyBackup(this.requireEnvelope());
  }

  createBackupBlob(serialized = this.serializeBackup()): Blob {
    return createLegacyBackupBlob(serialized);
  }

  createBackupFilename(): string {
    return createLegacyBackupFilename(this.requireEnvelope().createdAt);
  }

  prepareBackupDownload(): PreparedLegacyBackupDownload {
    const serialized = this.serializeBackup();
    return {
      serialized,
      blob: this.createBackupBlob(serialized),
      filename: this.createBackupFilename()
    };
  }

  markBackupDownloadTriggered(): void {
    this.backupDownloadTriggered = true;
  }

  canEnterConfirmation(): MigrationExecutionReadiness {
    const data = this.currentResult;
    if (!data || data.disposition !== "ready" || !data.plan.executable) {
      return { ready: false, reason: "当前检查结果还不能进入最终确认。" };
    }
    if (!this.backupDownloadTriggered) {
      return { ready: false, reason: "请先下载并保存原始备份。" };
    }
    return { ready: true };
  }

  setConfirmation(key: MigrationConfirmationKey, value: boolean): MigrationConfirmationValues {
    this.confirmations = { ...this.confirmations, [key]: value };
    return this.getConfirmationValues();
  }

  getConfirmationValues(): MigrationConfirmationValues {
    return { ...this.confirmations };
  }

  canStartExecution(): MigrationExecutionReadiness {
    const confirmationReadiness = this.canEnterConfirmation();
    if (!confirmationReadiness.ready) return confirmationReadiness;
    const data = this.currentResult!;
    if (!data.sourceValidation.valid || data.preview.summary.totalBlockingIssues > 0) {
      return { ready: false, reason: "当前仍有阻断问题，不能开始升级。" };
    }
    if (data.preview.summary.totalManualReview > 0 || data.plan.summary.manualReview > 0) {
      return { ready: false, reason: "仍有记录需要人工确认，不能开始升级。" };
    }
    if (!Object.values(this.confirmations).every(Boolean)) {
      return { ready: false, reason: "请完成四项确认后再开始升级。" };
    }
    return { ready: true };
  }

  checkExecutionSupport(): MigrationExecutionReadiness {
    return this.executionRuntime.isWebLocksAvailable()
      ? { ready: true }
      : { ready: false, reason: "当前浏览器不支持安全的数据升级，请使用最新版 Chrome 或 Edge 后重试。" };
  }

  async startExecution(
    onLifecycle?: (event: MigrationControllerLifecycleEvent) => void
  ): Promise<MigrationExecutionOutcome> {
    if (this.executionActive) {
      throw new MigrationExecutionError({
        code: "MIGRATION_ACTIVE_SESSION_EXISTS",
        message: "A migration execution is already active in this page.",
        recoverable: true
      });
    }
    const readiness = this.canStartExecution();
    if (!readiness.ready) {
      throw new MigrationExecutionError({
        code: "MIGRATION_USER_CONFIRMATION_REQUIRED",
        message: readiness.reason ?? "Migration confirmation is incomplete.",
        recoverable: true
      });
    }

    onLifecycle?.({ type: "checking_execution_support" });
    const support = this.checkExecutionSupport();
    if (!support.ready) {
      throw new MigrationExecutionError({
        code: "MIGRATION_LOCK_UNAVAILABLE",
        message: support.reason ?? "Browser Web Locks are unavailable.",
        recoverable: true
      });
    }

    const data = this.currentResult!;
    this.executionActive = true;
    this.closeWarning = undefined;
    this.abortController = this.executionRuntime.createAbortController();
    try {
      onLifecycle?.({ type: "opening_target" });
      const targetAdapter = this.executionRuntime.createTargetAdapter();
      this.targetAdapter = targetAdapter;
      if (!await targetAdapter.isAvailable()) {
        throw new MigrationExecutionError({
          code: "MIGRATION_TARGET_UNAVAILABLE",
          message: "The new local storage is unavailable.",
          recoverable: true,
          adapter: targetAdapter.kind
        });
      }
      await targetAdapter.open();
      if (this.abortController.signal.aborted) {
        throw new MigrationExecutionError({
          code: "MIGRATION_CANCELLED",
          message: "Migration was safely cancelled before execution.",
          recoverable: true
        });
      }

      const lockProvider = this.executionRuntime.createLockProvider();
      if (lockProvider.kind !== "web-locks" || lockProvider.isAvailable?.() === false) {
        throw new MigrationExecutionError({
          code: "MIGRATION_LOCK_UNAVAILABLE",
          message: "IndexedDB migration requires an available Web Locks provider.",
          recoverable: true,
          adapter: targetAdapter.kind
        });
      }
      const executor = this.executionRuntime.createExecutor({
        targetAdapter,
        lockProvider,
        expectedTargetSchemaVersion: MIGRATION_TARGET_SCHEMA_VERSION,
        onProgress: (progress) => onLifecycle?.({ type: "progress", progress })
      });
      const result = await executor.execute({
        envelope: data.envelope,
        preview: data.preview,
        plan: data.plan,
        userConfirmed: true,
        signal: this.abortController.signal
      });
      if (result.status !== "completed" || result.activeStorageSwitched !== false) {
        throw new MigrationExecutionError({
          code: "MIGRATION_VERIFY_FAILED",
          message: "Migration did not finish in completed-not-activated state.",
          recoverable: true,
          adapter: targetAdapter.kind
        });
      }
      return { result, closeWarning: this.closeWarning };
    } finally {
      this.executionActive = false;
      this.abortController = undefined;
      const adapter = this.targetAdapter;
      this.targetAdapter = undefined;
      if (adapter) {
        try {
          await adapter.close();
        } catch {
          this.closeWarning = "新存储连接关闭时出现提示，但不会覆盖本次升级结果。";
        }
      }
    }
  }

  requestCancellation(): boolean {
    if (!this.executionActive || !this.abortController || this.abortController.signal.aborted) return false;
    this.abortController.abort();
    return true;
  }

  isExecutionActive(): boolean {
    return this.executionActive;
  }

  getCloseWarning(): string | undefined {
    return this.closeWarning;
  }

  async dispose(): Promise<void> {
    if (this.executionActive) return;
    const adapter = this.targetAdapter;
    this.targetAdapter = undefined;
    if (adapter) await adapter.close().catch(() => undefined);
  }

  private requireEnvelope(): LegacyBackupEnvelope {
    if (!this.currentResult) {
      throw new Error("Migration inspection must complete before preparing a backup download.");
    }
    return this.currentResult.envelope;
  }
}

export function createReadonlyBrowserStorage(storage?: Storage): ReadonlyStorageLike {
  const source = storage ?? globalThis.localStorage;
  if (!source) throw new Error("Browser localStorage is unavailable.");

  // This remains a read-only migration boundary. Never pass the full Storage API to the controller.
  return {
    get length() {
      return source.length;
    },
    getItem(key: string) {
      return source.getItem(key);
    },
    key(index: number) {
      return source.key(index);
    }
  };
}

function hasLegacyProductData(envelope: LegacyBackupEnvelope): boolean {
  if (envelope.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY] === null) return false;
  const counts = envelope.normalizedSnapshot?.counts;
  if (!counts) return true;
  return PRODUCT_DATA_STORES.some((store) => (counts[store] ?? 0) > 0);
}

function getInspectionDisposition(
  envelope: LegacyBackupEnvelope,
  blockingIssueCount: number,
  warningCount: number,
  manualReviewCount: number,
  hasProductData: boolean
): MigrationInspectionDisposition {
  if (!hasProductData) return "empty";
  if (envelope.report.issues.some((issue) => issue.code === "CHECKSUM_UNAVAILABLE")) return "blocked";
  if (!envelope.normalizedSnapshot || blockingIssueCount > 0) return "blocked";
  if (warningCount > 0 || manualReviewCount > 0) return "review_required";
  return "ready";
}
