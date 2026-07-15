import { CheckCircle2, Download, LockKeyhole, RotateCcw } from "lucide-react";
import type { PreparedLegacyBackupDownload, MigrationUiError } from "./migration-preview-types";

interface MigrationBackupStepProps {
  downloaded: boolean;
  filename?: string;
  error?: MigrationUiError;
  onDownload: () => void;
  onBackToPreview: () => void;
}

export function MigrationBackupStep({ downloaded, filename, error, onDownload, onBackToPreview }: MigrationBackupStepProps) {
  return (
    <section className="migration-stage-card migration-backup" data-testid="migration-backup-step">
      <div className="migration-stage-heading">
        <span className="migration-stage-icon" aria-hidden="true"><Download size={22} /></span>
        <div>
          <p className="migration-kicker">第 3 步</p>
          <h2>先保存一份原始备份</h2>
          <p>这份备份保留当前浏览器里的原始收藏数据。即使后续升级中断，也可以用它恢复。备份不会上传到服务器。</p>
        </div>
      </div>

      <div className="migration-privacy-note">
        <LockKeyhole size={20} aria-hidden="true" />
        <div>
          <strong>请把备份留在自己的设备中</strong>
          <span>备份中可能包含收藏标题、备注和来源链接，请不要随意分享。</span>
        </div>
      </div>

      {downloaded && (
        <div className="migration-download-success" aria-live="polite" data-testid="backup-download-status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <div>
            <strong>备份下载已触发</strong>
            <span>请确认浏览器下载列表中已经出现 JSON 文件{filename ? `：${filename}` : ""}。</span>
            <small>系统无法确认文件是否已经实际保存到磁盘。</small>
          </div>
        </div>
      )}

      {error && <div className="migration-inline-error" role="alert">{error.message}<code>{error.code}</code></div>}

      <div className="migration-backup-actions">
        <button className="primary-button" type="button" onClick={onDownload} data-testid="download-legacy-backup">
          <Download size={17} aria-hidden="true" /> {downloaded ? "再次下载原始备份" : "下载原始备份"}
        </button>
        <button className="migration-text-button" type="button" onClick={onBackToPreview}><RotateCcw size={16} />返回检查结果</button>
      </div>

      <p className="migration-next-stage-note">下一阶段将在完成执行安全接入后开放。目前不会写入新存储。</p>
    </section>
  );
}

export function triggerPreparedBackupDownload(prepared: PreparedLegacyBackupDownload): void {
  const objectUrl = URL.createObjectURL(prepared.blob);
  const link = document.createElement("a");
  try {
    link.href = objectUrl;
    link.download = prepared.filename;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
