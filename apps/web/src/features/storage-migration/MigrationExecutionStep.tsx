import { CircleStop, Database, LoaderCircle, ShieldCheck } from "lucide-react";
import type { MigrationExecutionProgress, StorageEntityName } from "@revival/storage-service";
import { STORAGE_ENTITY_LABELS } from "./migration-error-messages";
import type { MigrationInspectionResult, MigrationPreviewUiStateName } from "./migration-preview-types";

interface MigrationExecutionStepProps {
  status: MigrationPreviewUiStateName;
  data: MigrationInspectionResult;
  progress?: MigrationExecutionProgress;
  canCancel: boolean;
  onRequestCancel: () => void;
}

const PHASE_LABELS: Partial<Record<MigrationExecutionProgress["status"], string>> = {
  lock_acquiring: "正在获取安全锁",
  preflight: "正在核对原始备份和升级计划",
  backup_persisted: "正在保存恢复备份",
  writing_store: "正在写入本地数据",
  verifying_store: "正在核对已写入的数据",
  verifying_all: "正在完成最终校验",
  completed: "升级完成",
  cancelled: "升级已安全停止",
  failed: "升级没有完成"
};

export function MigrationExecutionStep({ status, data, progress, canCancel, onRequestCancel }: MigrationExecutionStepProps) {
  const totalRecords = Object.values(data.plan.expectedWriteCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const completedRecords = Object.values(progress?.writtenCounts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  const percent = calculateMigrationPercent(status, progress);
  const phase = getPhaseLabel(status, progress);
  const storeLabel = progress?.currentStore ? getStoreLabel(progress.currentStore) : "准备升级";

  return (
    <section className="migration-stage-card migration-execution-card" data-testid="migration-execution-step">
      <div className="migration-stage-heading">
        <span className="migration-stage-icon migration-stage-icon--active" aria-hidden="true"><LoaderCircle size={22} /></span>
        <div>
          <p className="migration-kicker">第 5 步</p>
          <h2 tabIndex={-1} data-migration-focus-heading>正在升级本地数据</h2>
          <p>系统正在写入已经检查通过的数据。原来的收藏仍然保留，新存储不会立即启用。</p>
        </div>
      </div>

      <div className="migration-live-phase" aria-live="polite">
        <ShieldCheck size={20} aria-hidden="true" />
        <div>
          <span>当前阶段</span>
          <strong>{phase}</strong>
          <small data-testid="migration-current-store">{storeLabel}</small>
        </div>
      </div>

      <div className="migration-execution-progress">
        <div className="migration-progress-heading">
          <span>升级进度</span>
          <strong>{percent}%</strong>
        </div>
        <div
          className="migration-progressbar"
          role="progressbar"
          aria-label="本地数据升级进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>

      <div className="migration-execution-metrics">
        <span><Database size={18} aria-hidden="true" /><small>已完成记录</small><strong>{completedRecords} / {totalRecords}</strong></span>
        <span><ShieldCheck size={18} aria-hidden="true" /><small>已验证模块</small><strong>{progress?.completedStores ?? 0} / {progress?.totalStores ?? data.plan.requiredStores.length}</strong></span>
      </div>

      {status === "cancelling" ? (
        <div className="migration-cancelling-note" aria-live="assertive">
          正在完成当前模块并安全停止。请保持此页面打开。
        </div>
      ) : (
        <div className="migration-execution-actions">
          <button className="migration-text-button" type="button" onClick={onRequestCancel} disabled={!canCancel}>
            <CircleStop size={17} aria-hidden="true" />安全停止
          </button>
          <span>停止请求会在当前模块事务完成后生效。</span>
        </div>
      )}
    </section>
  );
}

export function calculateMigrationPercent(
  status: MigrationPreviewUiStateName,
  progress?: MigrationExecutionProgress
): number {
  if (status === "completed_not_activated") return 100;
  if (status === "checking_execution_support") return 1;
  if (status === "opening_target") return 2;
  if (!progress) return 0;
  if (progress.status === "lock_acquiring") return 3;
  if (progress.status === "preflight" || progress.status === "backup_persisted") return 5;
  if (progress.status === "verifying_all") return 95;
  if (progress.status === "completed") return 100;
  if (progress.totalStores <= 0) return 5;
  return Math.max(5, Math.min(95, Math.round(5 + (progress.completedStores / progress.totalStores) * 90)));
}

function getPhaseLabel(status: MigrationPreviewUiStateName, progress?: MigrationExecutionProgress): string {
  if (status === "checking_execution_support") return "正在检查浏览器安全能力";
  if (status === "opening_target") return "正在打开新的本地存储";
  if (status === "cancelling") return "正在安全停止";
  if (status === "verifying") return progress ? PHASE_LABELS[progress.status] ?? "正在校验" : "正在校验";
  return progress ? PHASE_LABELS[progress.status] ?? "正在处理" : "正在准备";
}

function getStoreLabel(store: StorageEntityName): string {
  return STORAGE_ENTITY_LABELS[store];
}
