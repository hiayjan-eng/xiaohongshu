import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useReducer, useRef } from "react";
import { MigrationBackupStep, triggerPreparedBackupDownload } from "./MigrationBackupStep";
import { MigrationInspectionStep } from "./MigrationInspectionStep";
import { MigrationPreviewStep } from "./MigrationPreviewStep";
import { MigrationFlowController, createReadonlyBrowserStorage, MIGRATION_INSPECTION_PROGRESS } from "./migration-flow-controller";
import { toSafeMigrationUiError } from "./migration-error-messages";
import { initialMigrationPreviewUiState, migrationPreviewReducer } from "./migration-preview-reducer";
import "./migration-data-upgrade.css";

interface MigrationDataUpgradePageProps {
  onBackToSettings: () => void;
  onReturnToImport: () => void;
}

const STEPS = ["检查数据", "查看结果", "保存备份"] as const;

export function MigrationDataUpgradePage({ onBackToSettings, onReturnToImport }: MigrationDataUpgradePageProps) {
  const [state, dispatch] = useReducer(migrationPreviewReducer, initialMigrationPreviewUiState);
  const controllerRef = useRef<MigrationFlowController | null>(null);
  const currentStep = getCurrentStep(state.status);

  async function inspectCurrentData() {
    dispatch({ type: "START_INSPECTION", progress: MIGRATION_INSPECTION_PROGRESS[0] });
    try {
      const controller = new MigrationFlowController(createReadonlyBrowserStorage());
      controllerRef.current = controller;
      const data = await controller.inspect((progress) => dispatch({ type: "INSPECTION_PROGRESS", progress }));
      dispatch({ type: "INSPECTION_SUCCEEDED", data });
    } catch (error) {
      controllerRef.current = null;
      dispatch({ type: "INSPECTION_FAILED", error: toSafeMigrationUiError(error) });
    }
  }

  function downloadBackup() {
    try {
      const controller = controllerRef.current;
      if (!controller) throw new Error("Migration inspection is no longer available.");
      const prepared = controller.prepareBackupDownload();
      triggerPreparedBackupDownload(prepared);
      dispatch({ type: "BACKUP_DOWNLOAD_SUCCEEDED", filename: prepared.filename });
    } catch (error) {
      dispatch({ type: "BACKUP_DOWNLOAD_FAILED", error: toSafeMigrationUiError(error) });
    }
  }

  function reinspect() {
    controllerRef.current = null;
    void inspectCurrentData();
  }

  return (
    <div className="migration-upgrade-page" data-testid="migration-data-upgrade-page">
      <button className="migration-back-link" type="button" onClick={onBackToSettings}>
        <ArrowLeft size={17} aria-hidden="true" /> 返回设置
      </button>

      <header className="migration-page-header">
        <p className="eyebrow">设置 · 数据管理</p>
        <h1>升级本地数据存储</h1>
        <p>先检查、再备份。当前不会修改任何收藏。</p>
      </header>

      <ol className="migration-steps" aria-label="数据检查步骤">
        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const completed = stepNumber < currentStep || (state.status === "backup_downloaded" && stepNumber === 3);
          const active = stepNumber === currentStep;
          return (
            <li key={step} className={active ? "active" : completed ? "completed" : ""} aria-current={active ? "step" : undefined}>
              <span>{completed ? <CheckCircle2 size={16} aria-hidden="true" /> : stepNumber}</span>
              <strong>{step}</strong>
            </li>
          );
        })}
      </ol>

      {(state.status === "idle" || state.status === "inspecting") && (
        <MigrationInspectionStep
          inspecting={state.status === "inspecting"}
          progress={state.status === "inspecting" ? state.progress : undefined}
          onInspect={() => void inspectCurrentData()}
        />
      )}

      {(state.status === "preview_ready" || state.status === "review_required" || state.status === "blocked") && (
        <MigrationPreviewStep
          status={state.status}
          data={state.data}
          onOpenBackup={() => dispatch({ type: "OPEN_BACKUP" })}
          onReinspect={reinspect}
          onReturnToImport={onReturnToImport}
        />
      )}

      {(state.status === "backup_ready" || state.status === "backup_downloaded") && (
        <MigrationBackupStep
          downloaded={state.status === "backup_downloaded"}
          filename={state.status === "backup_downloaded" ? state.filename : undefined}
          error={state.status === "backup_ready" ? state.downloadError : undefined}
          onDownload={downloadBackup}
          onBackToPreview={() => dispatch({ type: "BACK_TO_PREVIEW" })}
        />
      )}

      {state.status === "inspection_failed" && (
        <section className="migration-stage-card migration-failed" role="alert" data-testid="migration-inspection-failed">
          <h2>这次检查没有完成</h2>
          <p>{state.error.message}</p>
          <details><summary>查看安全错误码</summary><code>{state.error.code}</code></details>
          <div className="migration-footer-actions">
            <button className="primary-button" type="button" onClick={() => void inspectCurrentData()}>重新检查</button>
            <button className="migration-text-button" type="button" onClick={onBackToSettings}>返回设置</button>
          </div>
        </section>
      )}

      <p className="migration-memory-note">检查结果只保留在当前页面。刷新或离开后需要重新检查。</p>
    </div>
  );
}

function getCurrentStep(status: string): number {
  if (status === "backup_ready" || status === "backup_downloaded") return 3;
  if (status === "preview_ready" || status === "review_required" || status === "blocked") return 2;
  return 1;
}
