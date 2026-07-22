import { AlertTriangle, Database, Download, RefreshCcw, ShieldAlert, Wrench } from "lucide-react";
import { useState } from "react";
import type { SafeActivationRecoveryReport } from "@revival/storage-runtime";
import type { PreparedMigrationDownload } from "../features/storage-migration/migration-recovery-controller";

export interface StorageRecoveryScreenProps {
  report?: SafeActivationRecoveryReport;
  loading?: boolean;
  actionError?: string;
  onRefresh: () => Promise<void>;
  onRetryBoot: () => Promise<void>;
  onCancelUncommitted: () => Promise<void>;
  onFinalizeMarker: () => Promise<void>;
  onLegacyBackup: () => Promise<PreparedMigrationDownload>;
  onIndexedDbSnapshot: () => Promise<PreparedMigrationDownload>;
  onSafeReport: () => PreparedMigrationDownload;
}

export function StorageRecoveryScreen(props: StorageRecoveryScreenProps) {
  const [downloadMessage, setDownloadMessage] = useState("");
  const report = props.report;
  const allowed = (action: string) => Boolean(report?.allowedActions.includes(action as never));

  async function download(factory: () => Promise<PreparedMigrationDownload> | PreparedMigrationDownload) {
    try {
      const prepared = await factory();
      triggerDownload(prepared);
      setDownloadMessage(`下载已触发：${prepared.filename}`);
    } catch {
      setDownloadMessage("导出没有完成，当前数据未被修改。请稍后重试。");
    }
  }

  if (!report) {
    return (
      <main className="storage-recovery-screen" data-testid="storage-recovery-loading" aria-live="polite">
        <section className="storage-recovery-panel"><RefreshCcw className="activation-spinner" aria-hidden="true" /><h1>正在检查存储恢复状态</h1><p>系统只会读取 Marker、Journal 和迁移凭证，不会猜测或覆盖数据源。</p></section>
      </main>
    );
  }

  return (
    <main className="storage-recovery-screen" data-testid="storage-recovery-screen">
      <section className="storage-recovery-panel" role="alert">
        <header className="storage-recovery-heading">
          <span><ShieldAlert aria-hidden="true" /></span>
          <div><p className="app-boot-kicker">本地数据恢复</p><h1>存储启动需要处理</h1><p>普通收藏页面保持关闭。系统不会静默切回旧存储，也不会清空 IndexedDB。</p></div>
        </header>

        <dl className="storage-recovery-facts">
          <div><dt>启动标记</dt><dd>{humanState(report.markerState)}</dd></div>
          <div><dt>激活记录</dt><dd>{humanState(report.journalStatus ?? "missing")}</dd></div>
          <div><dt>迁移记录</dt><dd>{humanState(report.migrationStatus ?? "missing")}</dd></div>
          <div><dt>正式切换</dt><dd>{report.activeStorageSwitched ? "已提交" : "尚未提交"}</dd></div>
          <div><dt>IndexedDB</dt><dd>{report.indexedDbReadable ? "可以读取" : "暂时无法读取"}</dd></div>
          <div><dt>原始备份</dt><dd>{report.backupAvailable ? "存在" : "未确认"}</dd></div>
        </dl>

        {(props.actionError || report.safeErrorCode) && <details className="storage-recovery-details"><summary>查看安全错误码</summary><code>{props.actionError ?? report.safeErrorCode}</code></details>}

        <div className="storage-recovery-actions">
          {allowed("retry_indexeddb_boot") && <button className="primary-button" type="button" disabled={props.loading} onClick={() => void props.onRetryBoot()}><RefreshCcw size={17} aria-hidden="true" />重试 IndexedDB 启动</button>}
          {allowed("finalize_committed_marker") && <button className="primary-button" type="button" disabled={props.loading} onClick={() => void props.onFinalizeMarker()}><Wrench size={17} aria-hidden="true" />完成启用标记</button>}
          {allowed("cancel_uncommitted_activation") && <button className="secondary-button" type="button" disabled={props.loading} onClick={() => void props.onCancelUncommitted()}><AlertTriangle size={17} aria-hidden="true" />取消未提交的启用</button>}
          <button className="secondary-button" type="button" disabled={props.loading} onClick={() => void props.onRefresh()}><RefreshCcw size={17} aria-hidden="true" />刷新状态</button>
        </div>

        <div className="storage-recovery-exports">
          <h2><Database size={18} aria-hidden="true" />保留恢复材料</h2>
          <div>
            {allowed("export_legacy_backup") && <button type="button" onClick={() => void download(props.onLegacyBackup)}><Download size={16} aria-hidden="true" />导出原始备份</button>}
            {allowed("export_indexeddb_snapshot") && <button type="button" onClick={() => void download(props.onIndexedDbSnapshot)}><Download size={16} aria-hidden="true" />导出 IndexedDB 快照</button>}
            <button type="button" onClick={() => void download(props.onSafeReport)}><Download size={16} aria-hidden="true" />导出安全报告</button>
          </div>
          <p>导出只在当前设备生成文件，不会上传服务器，也不会改变存储状态。</p>
        </div>
        {downloadMessage && <p className="migration-download-success" aria-live="polite">{downloadMessage}</p>}
      </section>
    </main>
  );
}

function triggerDownload(prepared: PreparedMigrationDownload): void {
  const url = URL.createObjectURL(prepared.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = prepared.filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  try { anchor.click(); } finally { anchor.remove(); URL.revokeObjectURL(url); }
}
function humanState(value: string): string {
  const labels: Record<string, string> = {
    missing: "未找到",
    invalid: "需要修复",
    unsupported: "版本不支持",
    activation_prepared: "准备完成",
    activating: "切换启动中",
    indexeddb_active: "IndexedDB 已启用",
    recovery_required: "需要恢复",
    switching: "等待启动验证",
    boot_verifying: "启动验证中",
    committed: "已提交",
    activation_failed: "启动未完成",
    completed: "迁移完成"
  };
  return labels[value] ?? value.replaceAll("_", " ");
}