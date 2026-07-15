import { CheckCircle2, Database, FileJson, FolderSearch, ShieldCheck } from "lucide-react";
import type { MigrationInspectionProgress } from "./migration-preview-types";

const INSPECTION_ITEMS = [
  "收藏数据",
  "扫描与导入批次",
  "智能专辑",
  "行动卡",
  "计划卡",
  "分类纠正",
  "主题和成就",
  "原始备份可用性"
] as const;

interface MigrationInspectionStepProps {
  inspecting: boolean;
  progress?: MigrationInspectionProgress;
  onInspect: () => void;
}

export function MigrationInspectionStep({ inspecting, progress, onInspect }: MigrationInspectionStepProps) {
  return (
    <section className="migration-stage-card migration-inspection" data-testid="migration-inspection-step">
      <div className="migration-stage-heading">
        <span className="migration-stage-icon" aria-hidden="true"><FolderSearch size={22} /></span>
        <div>
          <p className="migration-kicker">第 1 步</p>
          <h2>先检查一下当前收藏</h2>
          <p>检查只会读取当前浏览器里的收藏、专辑和行动记录，不会修改或删除任何内容。</p>
        </div>
      </div>

      <div className="migration-primary-action">
        <button className="primary-button" type="button" onClick={onInspect} disabled={inspecting} data-testid="start-migration-inspection">
          {inspecting ? "正在检查…" : "开始检查"}
        </button>
        <span><ShieldCheck size={16} aria-hidden="true" /> 数据只在当前浏览器中处理，不会上传服务器。</span>
      </div>

      {inspecting && progress && (
        <div className="migration-progress" aria-live="polite" data-testid="migration-inspection-progress">
          <div className="migration-progress__pulse" aria-hidden="true" />
          <div>
            <strong>{progress.label}</strong>
            <span>所有处理都在当前浏览器中进行。</span>
          </div>
        </div>
      )}

      <div className="migration-inspection-grid" aria-label="检查项目">
        {INSPECTION_ITEMS.map((item, index) => (
          <span key={item}>
            {index % 3 === 0 ? <Database size={16} /> : index % 3 === 1 ? <FileJson size={16} /> : <CheckCircle2 size={16} />}
            {item}
          </span>
        ))}
      </div>

    </section>
  );
}
