import { AlertTriangle, CheckCircle2, Download, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import type { MigrationRecoveryInspectionResult, MigrationRecoveryReport } from "./migration-recovery-controller";
import { MigrationReportPanel } from "./MigrationReportPanel";
import type { MigrationUiError } from "./migration-preview-types";

interface MigrationRecoveryOverviewProps {
  recovery: MigrationRecoveryInspectionResult;
  report?: MigrationRecoveryReport;
  reportExpanded: boolean;
  reportFilename?: string;
  storedBackupFilename?: string;
  refreshing: boolean;
  error?: MigrationUiError;
  onResume: () => void;
  onRollback: () => void;
  onReinspectLegacy: () => void;
  onRefresh: () => void;
  onDownloadBackup: () => void;
  onToggleReport: () => void;
  onDownloadReport: () => void;
  onReturnToSettings: () => void;
}

export function MigrationRecoveryOverview(props: MigrationRecoveryOverviewProps) {
  const { recovery, report, reportExpanded, reportFilename, storedBackupFilename, refreshing } = props;
  const inspection = recovery.inspection;
  const metadata = inspection?.metadata;
  const content = recoveryCopy(recovery.disposition, recovery.reason, props.error?.code);
  const completed = inspection?.checkpoints.filter((checkpoint) => checkpoint.status === "verified" || checkpoint.status === "rolled_back").length ?? 0;
  const written = Object.values(metadata?.writtenCounts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  const planned = inspection?.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.expectedCount, 0) ?? 0;
  return (
    <section className={`migration-stage-card migration-recovery-overview migration-recovery-overview--${content.tone}`} role={content.tone === "danger" ? "alert" : undefined} data-testid={recoveryTestId(recovery.disposition, props.error?.code)}>
      <div className="migration-result-heading">
        <span aria-hidden="true">{content.tone === "success" ? <CheckCircle2 size={25} /> : content.tone === "danger" ? <AlertTriangle size={25} /> : <ShieldCheck size={25} />}</span>
        <div>
          <p className="migration-kicker">上次升级状态</p>
          <h2 tabIndex={-1} data-migration-focus-heading>{content.title}</h2>
          <p>{content.description}</p>
        </div>
      </div>

      {inspection && metadata && (
        <dl className="migration-recovery-facts">
          <div><dt>升级编号</dt><dd>{shortIdentifier(inspection.migrationId)}</dd></div>
          <div><dt>开始时间</dt><dd>{formatDate(metadata.startedAt)}</dd></div>
          <div><dt>已处理模块</dt><dd>{completed} / {inspection.checkpoints.length}</dd></div>
          <div><dt>已写入记录</dt><dd>{written} / {planned}</dd></div>
          <div><dt>原始备份</dt><dd>{inspection.backup.status === "verified" ? "已校验" : "需要检查"}</dd></div>
          <div><dt>当前使用</dt><dd>旧本地存储</dd></div>
          <div><dt>可以继续</dt><dd>{inspection.canResume ? "是" : "否"}</dd></div>
          <div><dt>可以恢复</dt><dd>{inspection.canRollback ? "是" : "否"}</dd></div>
        </dl>
      )}

      {recovery.disposition === "rollback_failed" && inspection && (
        <div className="migration-inline-error">
          <strong>恢复没有全部完成</strong>
          <p>已经清理的模块保持为空，未处理模块仍保留。原始备份和升级记录没有删除。</p>
        </div>
      )}

      {props.error && (
        <div className="migration-inline-error" role="alert">
          <strong>{props.error.message}</strong>
          <details><summary>查看技术详情</summary><code>错误代码：{props.error.code}</code></details>
        </div>
      )}

      <div className="migration-recovery-actions">
        {recovery.disposition === "resume_available" && inspection?.canResume && <button className="primary-button" type="button" onClick={props.onResume}>继续升级</button>}
        {(recovery.disposition === "rollback_available" || recovery.disposition === "resume_available" || recovery.disposition === "completed_not_activated") && inspection?.canRollback && (
          <button className="secondary-button" type="button" onClick={props.onRollback}>恢复到升级前</button>
        )}
        {recovery.disposition === "rollback_failed" && inspection?.canRollback && <button className="migration-warning-button" type="button" onClick={props.onRollback}>继续恢复</button>}
        {recovery.disposition === "rolled_back" && <button className="primary-button" type="button" onClick={props.onReinspectLegacy}>重新检查当前数据</button>}
        {inspection?.backup.status === "verified" && <button className="migration-text-button" type="button" onClick={props.onDownloadBackup}><Download size={16} aria-hidden="true" />重新下载原始备份</button>}
        <button className="migration-text-button" type="button" disabled={refreshing} onClick={props.onRefresh}><RefreshCw size={16} aria-hidden="true" />{refreshing ? "正在刷新" : "刷新状态"}</button>
        <button className="migration-text-button" type="button" onClick={props.onReturnToSettings}>返回设置</button>
      </div>
      {storedBackupFilename && <p className="migration-download-success" aria-live="polite">备份下载已触发：{storedBackupFilename}</p>}

      {inspection && report && (
        <MigrationReportPanel
          inspection={inspection}
          report={report}
          expanded={reportExpanded}
          downloadedFilename={reportFilename}
          onToggle={props.onToggleReport}
          onDownload={props.onDownloadReport}
        />
      )}
      {recovery.lockStatus === "held" && <p className="migration-lock-note"><RotateCcw size={16} aria-hidden="true" />另一个页面正在处理。锁释放后点击“刷新状态”。</p>}
    </section>
  );
}

function recoveryCopy(disposition: MigrationRecoveryInspectionResult["disposition"], reason?: string, errorCode?: string) {
  if (errorCode === "MIGRATION_CANCELLED") return { tone: "warning", title: "升级已安全停止", description: "已经完成的模块保留在新存储中。当前使用：旧本地存储，原来的收藏数据仍然保留。" } as const;
  if (disposition === "completed_not_activated") return { tone: "success", title: "本地数据升级完成，尚未启用", description: "新存储已写入并校验，已准备，尚未启用；当前产品仍然使用旧本地存储，原始数据仍然保留。" } as const;
  if (disposition === "rolled_back") return { tone: "success", title: "已经恢复到升级前", description: "本次写入的新存储已经清理，原来的收藏数据仍然保留。" } as const;
  if (disposition === "rollback_failed") return { tone: "danger", title: "上次恢复没有全部完成", description: "请继续恢复，不要清理浏览器数据。旧收藏和原始备份仍然保留。" } as const;
  if (disposition === "another_session_running") return { tone: "warning", title: "另一个页面正在处理这次升级", description: reason ?? "等待另一个页面完成后刷新状态。" } as const;
  if (disposition === "recovery_blocked") return { tone: "danger", title: "当前状态需要先确认", description: reason ?? "当前不能自动继续或恢复，旧收藏没有被修改。" } as const;
  if (disposition === "rollback_available") return { tone: "warning", title: "上次升级遇到问题", description: "当前不能安全继续，但可以清理本次写入的新存储。旧收藏仍然保留。" } as const;
  return { tone: "warning", title: "发现一次未完成的升级", description: "系统找到了安全断点。你可以主动继续升级，或恢复到升级前。" } as const;
}

function recoveryTestId(disposition: MigrationRecoveryInspectionResult["disposition"], errorCode?: string): string {
  if (disposition === "completed_not_activated") return "migration-completed-not-activated";
  if (errorCode === "MIGRATION_CANCELLED") return "migration-cancelled";
  if (errorCode) return "migration-execution-failed";
  return `migration-recovery-${disposition}`;
}

function shortIdentifier(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._:-]/g, "_");
  return safe.length > 20 ? `${safe.slice(0, 12)}…${safe.slice(-6)}` : safe;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间待确认" : date.toLocaleString("zh-CN", { hour12: false });
}
