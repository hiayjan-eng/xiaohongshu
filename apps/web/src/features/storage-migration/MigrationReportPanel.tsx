import { Download, FileText } from "lucide-react";
import type { MigrationExecutionInspection } from "@revival/storage-service";
import { STORAGE_ENTITY_LABELS } from "./migration-error-messages";
import type { MigrationRecoveryReport } from "./migration-recovery-controller";

interface MigrationReportPanelProps {
  inspection: MigrationExecutionInspection;
  report: MigrationRecoveryReport;
  expanded: boolean;
  downloadedFilename?: string;
  onToggle: () => void;
  onDownload: () => void;
}

export function MigrationReportPanel({ inspection, report, expanded, downloadedFilename, onToggle, onDownload }: MigrationReportPanelProps) {
  const written = Object.values(report.writtenCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  const verified = Object.values(report.verifiedCounts).reduce((sum, count) => sum + (count ?? 0), 0);
  return (
    <section className="migration-report-panel" data-testid="migration-recovery-report">
      <button className="migration-report-toggle" type="button" aria-expanded={expanded} onClick={onToggle}>
        <FileText size={19} aria-hidden="true" />
        <span><strong>升级报告</strong><small>只包含状态、数量和安全编号，不包含收藏正文或备注。</small></span>
      </button>
      {expanded && (
        <div className="migration-report-content">
          <dl className="migration-recovery-facts">
            <div><dt>升级编号</dt><dd>{shortIdentifier(report.migrationId)}</dd></div>
            <div><dt>执行编号</dt><dd>{shortIdentifier(report.executionId)}</dd></div>
            <div><dt>当前状态</dt><dd>{statusLabel(report.status)}</dd></div>
            <div><dt>已写入记录</dt><dd>{written}</dd></div>
            <div><dt>已校验记录</dt><dd>{verified}</dd></div>
            <div><dt>继续次数</dt><dd>{report.resumeCount}</dd></div>
            <div><dt>原始备份</dt><dd>{report.backup.status === "verified" ? "已校验" : "需要检查"}</dd></div>
            <div><dt>当前使用</dt><dd>{report.activeStorageSwitched ? "新本地存储" : "旧本地存储"}</dd></div>
            <div><dt>新存储</dt><dd>{report.activeStorageSwitched ? "已标记启用，需要人工检查" : "尚未启用"}</dd></div>
          </dl>
          <div className="migration-report-checkpoints">
            {inspection.checkpoints.map((checkpoint) => (
              <details key={checkpoint.store}>
                <summary><span>{STORAGE_ENTITY_LABELS[checkpoint.store]}</span><strong>{checkpointStatusLabel(checkpoint.status)}</strong></summary>
                <dl>
                  <div><dt>计划记录</dt><dd>{checkpoint.expectedCount}</dd></div>
                  <div><dt>已写入</dt><dd>{checkpoint.writtenCount}</dd></div>
                  <div><dt>已验证</dt><dd>{checkpoint.verifiedCount}</dd></div>
                  {checkpoint.errorCode && <div><dt>安全错误码</dt><dd><code>{checkpoint.errorCode}</code></dd></div>}
                </dl>
              </details>
            ))}
          </div>
          {report.warningCodes.length > 0 && (
            <details className="migration-technical-details">
              <summary>查看技术详情</summary>
              <ul>{report.warningCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
            </details>
          )}
          <button className="secondary-button" type="button" onClick={onDownload}><Download size={17} aria-hidden="true" />下载迁移报告</button>
          {downloadedFilename && <p className="migration-download-success" aria-live="polite">报告下载已触发：{downloadedFilename}</p>}
        </div>
      )}
    </section>
  );
}

function shortIdentifier(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._:-]/g, "_");
  return safe.length > 20 ? `${safe.slice(0, 12)}…${safe.slice(-6)}` : safe;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    completed: "升级完成，尚未启用",
    cancelled: "已安全停止",
    failed: "升级遇到问题",
    rollback_failed: "恢复未完成",
    rolled_back: "已恢复到升级前",
    writing_store: "写入中断",
    verifying_store: "校验中断",
    verifying_all: "最终校验中断"
  };
  return labels[status] ?? "等待处理";
}

function checkpointStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    writing: "写入中断",
    written: "待校验",
    verified: "已校验",
    failed: "处理失败",
    rolled_back: "已清理"
  };
  return labels[status] ?? "待确认";
}
