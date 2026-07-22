import { Database, LoaderCircle, ShieldCheck } from "lucide-react";
import type { MigrationExecutionInspection, MigrationExecutionProgress } from "@revival/storage-service";
import { STORAGE_ENTITY_LABELS } from "./migration-error-messages";

interface MigrationRecoveryProgressProps {
  operation: "resume" | "rollback";
  inspection: MigrationExecutionInspection;
  progress?: MigrationExecutionProgress;
  canCancel: boolean;
  onCancel: () => void;
}

export function MigrationRecoveryProgress({ operation, inspection, progress, canCancel, onCancel }: MigrationRecoveryProgressProps) {
  const rollback = operation === "rollback";
  const completedStores = progress?.completedStores ?? inspection.checkpoints.filter((entry) => entry.status === "verified").length;
  const totalStores = progress?.totalStores || inspection.checkpoints.length;
  const percent = rollback
    ? Math.max(5, Math.min(100, Math.round((completedStores / Math.max(1, totalStores)) * 100)))
    : Math.max(5, Math.min(100, Math.round((completedStores / Math.max(1, totalStores)) * 100)));
  const currentStore = progress?.currentStore ? STORAGE_ENTITY_LABELS[progress.currentStore] : rollback ? "准备清理新存储" : "正在寻找安全断点";
  return (
    <section className="migration-stage-card migration-execution-card" data-testid={rollback ? "migration-rollback-progress" : "migration-resume-progress"}>
      <div className="migration-stage-heading">
        <span className="migration-stage-icon migration-stage-icon--active" aria-hidden="true"><LoaderCircle size={22} /></span>
        <div>
          <p className="migration-kicker">{rollback ? "恢复进行中" : "继续升级"}</p>
          <h2 tabIndex={-1} data-migration-focus-heading>{rollback ? "正在恢复到升级前" : "正在继续升级"}</h2>
          <p>{rollback ? "正在逐个清理本次升级写入的新存储模块。旧收藏不会删除，备份和升级记录会保留。" : "系统正在核对已完成模块，并从安全断点继续。原来的收藏仍然保留。"}</p>
        </div>
      </div>
      <div className="migration-live-phase" aria-live="polite">
        <ShieldCheck size={20} aria-hidden="true" />
        <div><span>当前阶段</span><strong>{recoveryPhaseLabel(operation, progress)}</strong><small>{currentStore}</small></div>
      </div>
      <div className="migration-execution-progress">
        <div className="migration-progress-heading"><span>{rollback ? "恢复进度" : "继续升级进度"}</span><strong>{percent}%</strong></div>
        <div className="migration-progressbar" role="progressbar" aria-label={rollback ? "恢复进度" : "继续升级进度"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="migration-execution-metrics">
        <span><Database size={18} aria-hidden="true" /><small>{rollback ? "已清理模块" : "已验证模块"}</small><strong>{completedStores} / {totalStores}</strong></span>
        <span><ShieldCheck size={18} aria-hidden="true" /><small>恢复备份</small><strong>{inspection.backup.status === "verified" ? "已校验" : "保留中"}</strong></span>
      </div>
      {!rollback && (
        <div className="migration-execution-actions">
          <button className="migration-text-button" type="button" disabled={!canCancel} onClick={onCancel}>安全停止</button>
          <span>停止请求会在当前模块事务完成后生效。</span>
        </div>
      )}
    </section>
  );
}

function recoveryPhaseLabel(operation: "resume" | "rollback", progress?: MigrationExecutionProgress): string {
  if (operation === "rollback") return progress?.currentStore ? "正在清理新存储模块" : "正在读取恢复记录";
  if (!progress) return "正在读取上次升级记录";
  if (progress.status === "lock_acquiring") return "正在取得安全升级锁";
  if (progress.status === "preflight") return "正在验证恢复备份";
  if (progress.status === "writing_store") return "正在继续写入";
  if (progress.status === "verifying_store") return "正在检查已完成模块";
  if (progress.status === "verifying_all") return "正在完成最终校验";
  return "正在寻找安全断点";
}
