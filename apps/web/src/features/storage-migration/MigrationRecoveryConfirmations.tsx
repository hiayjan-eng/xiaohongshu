import { ArrowLeft, RotateCcw, ShieldCheck } from "lucide-react";
import type { MigrationExecutionInspection } from "@revival/storage-service";

interface ResumeConfirmationProps {
  inspection: MigrationExecutionInspection;
  confirmed: boolean;
  onChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function MigrationResumeConfirmation({ inspection, confirmed, onChange, onCancel, onConfirm }: ResumeConfirmationProps) {
  const completed = inspection.checkpoints.filter((checkpoint) => checkpoint.status === "verified").length;
  const written = Object.values(inspection.metadata?.writtenCounts ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
  const planned = inspection.checkpoints.reduce((sum, checkpoint) => sum + checkpoint.expectedCount, 0);
  return (
    <section className="migration-stage-card migration-recovery-confirmation" data-testid="migration-resume-confirmation">
      <div className="migration-stage-heading">
        <span className="migration-stage-icon migration-stage-icon--active" aria-hidden="true"><RotateCcw size={22} /></span>
        <div>
          <p className="migration-kicker">继续升级</p>
          <h2>继续上一次升级？</h2>
          <p>系统会从已经完成并校验的模块之后继续，不会重新写入已确认的数据。原来的收藏仍然保留，新存储完成后也不会立即启用。</p>
        </div>
      </div>
      <dl className="migration-recovery-facts">
        <div><dt>已完成模块</dt><dd>{completed} / {inspection.checkpoints.length}</dd></div>
        <div><dt>已写入记录</dt><dd>{written} / {planned}</dd></div>
        <div><dt>恢复备份</dt><dd>{inspection.backup.status === "verified" ? "已校验" : "不可用"}</dd></div>
        <div><dt>当前使用</dt><dd>旧本地存储</dd></div>
      </dl>
      <label className="migration-confirmation-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => onChange(event.target.checked)} />
        <span><strong>我知道系统会使用上次保存的原始备份和升级记录继续。</strong></span>
      </label>
      <div className="migration-footer-actions">
        <button className="migration-text-button" type="button" onClick={onCancel}><ArrowLeft size={16} aria-hidden="true" />暂不继续</button>
        <button className="primary-button" type="button" disabled={!confirmed || !inspection.canResume} onClick={onConfirm}>继续升级</button>
      </div>
    </section>
  );
}

interface RollbackConfirmationProps {
  inspection: MigrationExecutionInspection;
  values: { clearNewStorage: boolean; recheckRequired: boolean };
  onChange: (key: "clearNewStorage" | "recheckRequired", value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function MigrationRollbackConfirmation({ inspection, values, onChange, onCancel, onConfirm }: RollbackConfirmationProps) {
  const ready = values.clearNewStorage && values.recheckRequired && inspection.canRollback;
  return (
    <section className="migration-stage-card migration-recovery-confirmation migration-recovery-confirmation--warning" data-testid="migration-rollback-confirmation">
      <div className="migration-stage-heading">
        <span className="migration-stage-icon migration-stage-icon--warning" aria-hidden="true"><ShieldCheck size={22} /></span>
        <div>
          <p className="migration-kicker">恢复新存储</p>
          <h2>恢复到升级前？</h2>
          <p>系统会清除本次升级写入的新存储数据。原来的收藏、备注、专辑和计划仍然保留在旧存储中，升级备份和升级记录也会继续保留。</p>
        </div>
      </div>
      <dl className="migration-recovery-facts">
        <div><dt>将清理</dt><dd>{inspection.checkpoints.length} 个新存储模块</dd></div>
        <div><dt>将保留</dt><dd>原始备份与升级记录</dd></div>
        <div><dt>当前使用</dt><dd>旧本地存储</dd></div>
        <div><dt>旧收藏</dt><dd>不会删除</dd></div>
      </dl>
      <label className="migration-confirmation-row">
        <input type="checkbox" checked={values.clearNewStorage} onChange={(event) => onChange("clearNewStorage", event.target.checked)} />
        <span><strong>我知道这会清除本次升级写入的新存储数据。</strong></span>
      </label>
      <label className="migration-confirmation-row">
        <input type="checkbox" checked={values.recheckRequired} onChange={(event) => onChange("recheckRequired", event.target.checked)} />
        <span><strong>我知道恢复后需要重新检查数据，才能再次升级。</strong></span>
      </label>
      <div className="migration-footer-actions">
        <button className="migration-text-button" type="button" onClick={onCancel}><ArrowLeft size={16} aria-hidden="true" />暂不恢复</button>
        <button className="migration-warning-button" type="button" disabled={!ready} onClick={onConfirm}>确认恢复</button>
      </div>
    </section>
  );
}
