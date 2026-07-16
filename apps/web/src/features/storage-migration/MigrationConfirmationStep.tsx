import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import type {
  MigrationConfirmationKey,
  MigrationConfirmationValues,
  MigrationExecutionReadiness,
  MigrationInspectionResult
} from "./migration-preview-types";

interface MigrationConfirmationStepProps {
  data: MigrationInspectionResult;
  values: MigrationConfirmationValues;
  readiness: MigrationExecutionReadiness;
  onChange: (key: MigrationConfirmationKey, value: boolean) => void;
  onStart: () => void;
  onBack: () => void;
}

const CONFIRMATIONS: ReadonlyArray<{ key: MigrationConfirmationKey; label: string }> = [
  { key: "legacyDataRetained", label: "我知道原来的本地收藏不会被删除。" },
  { key: "backupDownloaded", label: "我已经下载并检查浏览器下载列表中的原始备份。" },
  { key: "legacyStorageStillActive", label: "我知道升级完成后，当前产品暂时仍使用旧存储。" },
  { key: "activationRequiresNextPhase", label: "我知道新存储需要在下一阶段完成验证后才会正式启用。" }
];

export function MigrationConfirmationStep({
  data,
  values,
  readiness,
  onChange,
  onStart,
  onBack
}: MigrationConfirmationStepProps) {
  return (
    <div className="migration-confirmation-stack" data-testid="migration-confirmation-step">
      <section className="migration-stage-card migration-confirmation-card">
        <div className="migration-stage-heading">
          <span className="migration-stage-icon" aria-hidden="true"><ShieldCheck size={22} /></span>
          <div>
            <p className="migration-kicker">第 4 步</p>
            <h2>准备升级本地数据</h2>
            <p>接下来会把已经检查通过的数据写入新的本地存储。原来的收藏不会删除，新存储完成验证后也不会立即启用。</p>
          </div>
        </div>

        <div className="migration-confirmation-summary" aria-label="升级摘要">
          <span>收藏<strong>{data.userSummary.counts.savedItems} 条</strong></span>
          <span>智能专辑<strong>{data.userSummary.counts.smartAlbums} 个</strong></span>
          <span>行动卡<strong>{data.userSummary.counts.actionCards} 张</strong></span>
          <span>计划卡<strong>{data.userSummary.counts.planCards} 张</strong></span>
          <span>分类纠正<strong>{data.userSummary.counts.corrections} 条</strong></span>
          <span>检查结果<strong>可以升级</strong></span>
        </div>

        <div className="migration-confirmation-status">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>原始备份已生成并触发下载。请确认浏览器下载列表中可以看到 JSON 文件。</span>
        </div>

        <fieldset className="migration-confirmation-list">
          <legend>开始前，请逐项确认</legend>
          {CONFIRMATIONS.map((confirmation) => (
            <label key={confirmation.key}>
              <input
                type="checkbox"
                checked={values[confirmation.key]}
                onChange={(event) => onChange(confirmation.key, event.target.checked)}
              />
              <span>{confirmation.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="migration-confirmation-actions">
          <button className="migration-text-button" type="button" onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />返回备份
          </button>
          <div>
            <button
              className="primary-button"
              type="button"
              disabled={!readiness.ready}
              onClick={onStart}
              aria-describedby="migration-start-reason"
              data-testid="start-migration-execution"
            >
              开始升级
            </button>
            <p id="migration-start-reason">{readiness.ready ? "升级过程中可以安全停止，新存储不会立即启用。" : readiness.reason}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
