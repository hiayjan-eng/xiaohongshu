import { AlertTriangle, CheckCircle2, CircleStop, FileCheck2, ShieldCheck } from "lucide-react";
import type { MigrationExecutionProgress, MigrationExecutionResult } from "@revival/storage-service";
import { STORAGE_ENTITY_LABELS } from "./migration-error-messages";
import type { MigrationUiError } from "./migration-preview-types";

interface MigrationExecutionResultStepProps {
  status: "completed_not_activated" | "cancelled" | "execution_failed";
  result?: MigrationExecutionResult;
  progress?: MigrationExecutionProgress;
  error?: MigrationUiError;
  closeWarning?: string;
  onReturnToSettings: () => void;
}

export function MigrationExecutionResultStep({
  status,
  result,
  progress,
  error,
  closeWarning,
  onReturnToSettings
}: MigrationExecutionResultStepProps) {
  if (status === "completed_not_activated" && result) {
    const migratedRecords = Object.values(result.writtenCounts).reduce((sum, count) => sum + (count ?? 0), 0);
    const verifiedStores = result.checkpoints.filter((checkpoint) => checkpoint.status === "verified").length;
    return (
      <section className="migration-stage-card migration-result migration-result--completed" data-testid="migration-completed-not-activated">
        <div className="migration-result-heading">
          <span aria-hidden="true"><CheckCircle2 size={25} /></span>
          <div>
            <p className="migration-kicker">升级结果</p>
            <h2 tabIndex={-1} data-migration-focus-heading>本地数据升级完成</h2>
            <p>新存储已经完成写入和校验，但当前产品仍在使用原来的本地数据。下一阶段完成启用验证后，才会正式切换。</p>
          </div>
        </div>

        <div className="migration-activation-status">
          <span><small>当前使用的数据</small><strong>旧本地存储</strong></span>
          <span><small>新存储状态</small><strong>已准备，尚未启用</strong></span>
          <span><small>原始数据</small><strong>仍然保留</strong></span>
        </div>

        <div className="migration-result-metrics">
          <span><strong>{migratedRecords}</strong><small>已迁移记录</small></span>
          <span><strong>{verifiedStores}</strong><small>已验证模块</small></span>
          <span><strong>完整</strong><small>原始备份状态</small></span>
          <span><strong>{formatCompletedAt(result.completedAt)}</strong><small>完成时间</small></span>
        </div>

        <details className="migration-report-details">
          <summary>查看升级报告</summary>
          <dl>
            {result.checkpoints.map((checkpoint) => (
              <div key={checkpoint.store}>
                <dt>{STORAGE_ENTITY_LABELS[checkpoint.store]}</dt>
                <dd>{checkpoint.verifiedCount} 条 · {checkpoint.status === "verified" ? "已校验" : "待处理"}</dd>
              </div>
            ))}
            <div><dt>升级编号</dt><dd>{sanitizeIdentifier(result.migrationId)}</dd></div>
            <div><dt>备份编号</dt><dd>{sanitizeIdentifier(result.backupId)}</dd></div>
          </dl>
        </details>
        {closeWarning && <p className="migration-close-warning">{closeWarning}</p>}
        <button className="primary-button" type="button" onClick={onReturnToSettings}>返回设置</button>
      </section>
    );
  }

  const cancelled = status === "cancelled";
  return (
    <section
      className={`migration-stage-card migration-result ${cancelled ? "migration-result--cancelled" : "migration-result--failed"}`}
      role={cancelled ? undefined : "alert"}
      data-testid={cancelled ? "migration-cancelled" : "migration-execution-failed"}
    >
      <div className="migration-result-heading">
        <span aria-hidden="true">{cancelled ? <CircleStop size={25} /> : <AlertTriangle size={25} />}</span>
        <div>
          <p className="migration-kicker">{cancelled ? "安全停止" : "升级结果"}</p>
          <h2 tabIndex={-1} data-migration-focus-heading>{cancelled ? "升级已安全停止" : "升级没有完成"}</h2>
          <p>
            {cancelled
              ? "已经完成的模块保留在新存储中，但当前产品仍然使用原来的收藏数据。"
              : "新存储写入或校验时遇到问题。当前产品仍然使用原来的收藏数据，没有切换到不完整的新存储。"}
          </p>
        </div>
      </div>

      <div className="migration-result-safety">
        <span><ShieldCheck size={18} aria-hidden="true" />当前使用：旧本地存储</span>
        <span><FileCheck2 size={18} aria-hidden="true" />原始备份仍然保留</span>
        <span>已完成模块：{progress?.completedStores ?? 0} / {progress?.totalStores ?? 0}</span>
      </div>

      {!cancelled && error && (
        <div className="migration-inline-error">
          <strong>{error.message}</strong>
          <details><summary>查看技术详情</summary><code>错误代码：{error.code}</code></details>
        </div>
      )}
      {closeWarning && <p className="migration-close-warning">{closeWarning}</p>}
      <p className="migration-deferred-note">继续升级和恢复功能将在 Task 7C 完成安全接入后开放。本分支不会部署给真实用户。</p>
      <button className="migration-text-button" type="button" onClick={onReturnToSettings}>返回设置</button>
    </section>
  );
}

function formatCompletedAt(value?: string): string {
  if (!value) return "已完成";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "已完成" : parsed.toLocaleString("zh-CN", { hour12: false });
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 72);
}
