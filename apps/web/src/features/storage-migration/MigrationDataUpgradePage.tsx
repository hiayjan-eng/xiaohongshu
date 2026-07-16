import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useEffect, useReducer, useRef } from "react";
import { MigrationBackupStep, triggerPreparedBackupDownload } from "./MigrationBackupStep";
import { MigrationCancelDialog } from "./MigrationCancelDialog";
import { MigrationConfirmationStep } from "./MigrationConfirmationStep";
import { MigrationExecutionResultStep } from "./MigrationExecutionResultStep";
import { MigrationExecutionStep } from "./MigrationExecutionStep";
import { MigrationInspectionStep } from "./MigrationInspectionStep";
import { MigrationPreviewStep } from "./MigrationPreviewStep";
import {
  MigrationFlowController,
  createReadonlyBrowserStorage,
  MIGRATION_INSPECTION_PROGRESS,
  type MigrationControllerLifecycleEvent
} from "./migration-flow-controller";
import { toSafeMigrationUiError } from "./migration-error-messages";
import { initialMigrationPreviewUiState, migrationPreviewReducer } from "./migration-preview-reducer";
import type { MigrationConfirmationKey, MigrationPreviewUiStateName } from "./migration-preview-types";
import "./migration-data-upgrade.css";

interface MigrationDataUpgradePageProps {
  onBackToSettings: () => void;
  onReturnToImport: () => void;
  onExecutionActiveChange?: (active: boolean) => void;
}

const STEPS = ["检查数据", "查看结果", "保存备份", "最后确认", "执行升级"] as const;
const ACTIVE_EXECUTION_STATES = new Set<MigrationPreviewUiStateName>([
  "checking_execution_support",
  "opening_target",
  "acquiring_lock",
  "executing",
  "cancelling",
  "verifying"
]);

export function MigrationDataUpgradePage({
  onBackToSettings,
  onReturnToImport,
  onExecutionActiveChange
}: MigrationDataUpgradePageProps) {
  const [state, dispatch] = useReducer(migrationPreviewReducer, initialMigrationPreviewUiState);
  const controllerRef = useRef<MigrationFlowController | null>(null);
  const executionActive = ACTIVE_EXECUTION_STATES.has(state.status);
  const readiness = controllerRef.current?.canStartExecution() ?? { ready: false, reason: "请先完成数据检查和备份。" };

  useEffect(() => {
    if (!executionActive) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [executionActive]);

  useEffect(() => {
    onExecutionActiveChange?.(executionActive);
    return () => onExecutionActiveChange?.(false);
  }, [executionActive, onExecutionActiveChange]);

  useEffect(() => {
    if (state.currentStep === 5 || state.status === "execution_failed" || state.status === "cancelled") {
      document.querySelector<HTMLElement>("[data-migration-focus-heading]")?.focus();
    }
  }, [state.currentStep, state.status]);

  useEffect(() => () => {
    void controllerRef.current?.dispose();
  }, []);

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
      controller.markBackupDownloadTriggered();
      dispatch({ type: "BACKUP_DOWNLOAD_SUCCEEDED", filename: prepared.filename });
    } catch (error) {
      dispatch({ type: "BACKUP_DOWNLOAD_FAILED", error: toSafeMigrationUiError(error) });
    }
  }

  function enterConfirmation() {
    const readiness = controllerRef.current?.canEnterConfirmation();
    if (!readiness?.ready) return;
    dispatch({ type: "ENTER_CONFIRMATION" });
  }

  function setConfirmation(key: MigrationConfirmationKey, value: boolean) {
    controllerRef.current?.setConfirmation(key, value);
    dispatch({ type: "SET_CONFIRMATION", key, value });
  }

  async function startExecution() {
    const controller = controllerRef.current;
    if (!controller) return;
    dispatch({ type: "CHECK_EXECUTION_SUPPORT" });
    try {
      await waitForNextPaint();
      const outcome = await controller.startExecution(handleLifecycleEvent);
      dispatch({
        type: "EXECUTION_COMPLETED",
        result: outcome.result,
        closeWarning: controller.getCloseWarning()
      });
    } catch (error) {
      const safeError = toSafeMigrationUiError(error);
      if (safeError.code === "MIGRATION_CANCELLED") {
        dispatch({ type: "EXECUTION_CANCELLED", error: safeError, closeWarning: controller.getCloseWarning() });
      } else {
        dispatch({ type: "EXECUTION_FAILED", error: safeError, closeWarning: controller.getCloseWarning() });
      }
    }
  }

  function handleLifecycleEvent(event: MigrationControllerLifecycleEvent) {
    if (event.type === "checking_execution_support") dispatch({ type: "CHECK_EXECUTION_SUPPORT" });
    if (event.type === "opening_target") dispatch({ type: "OPENING_TARGET" });
    if (event.type === "progress") dispatch({ type: "EXECUTION_PROGRESS", progress: event.progress });
  }

  function requestCancellation() {
    if (controllerRef.current?.requestCancellation()) dispatch({ type: "CANCELLING" });
  }

  function reinspect() {
    controllerRef.current = null;
    void inspectCurrentData();
  }

  function handleBackToSettings() {
    if (executionActive && !window.confirm("升级仍在进行。离开后本页面不会自动恢复进度，确定要离开吗？")) return;
    onBackToSettings();
  }

  const showExecution = ACTIVE_EXECUTION_STATES.has(state.status);

  return (
    <div
      className="migration-upgrade-page"
      data-testid="migration-data-upgrade-page"
      data-migration-state={state.status}
    >
      <button className="migration-back-link" type="button" onClick={handleBackToSettings}>
        <ArrowLeft size={17} aria-hidden="true" /> 返回设置
      </button>

      <header className="migration-page-header">
        <p className="eyebrow">设置 · 数据管理</p>
        <h1>升级本地数据存储</h1>
        <p>先检查、再备份，确认后才会写入新存储。当前不会切换正在使用的数据源。</p>
      </header>

      <div className="migration-mobile-step" aria-live="polite">
        第 {state.currentStep} / 5 步 · {STEPS[state.currentStep - 1]}
      </div>
      <ol className="migration-steps migration-steps--five" aria-label="数据升级步骤">
        {STEPS.map((step, index) => {
          const stepNumber = index + 1;
          const completed = stepNumber < state.currentStep || (state.status === "completed_not_activated" && stepNumber === 5);
          const active = stepNumber === state.currentStep;
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
          progress={state.inspectionProgress}
          onInspect={() => void inspectCurrentData()}
        />
      )}

      {(state.status === "preview_ready" || state.status === "review_required" || state.status === "blocked") && state.data && (
        <MigrationPreviewStep
          status={state.status}
          data={state.data}
          onOpenBackup={() => dispatch({ type: "OPEN_BACKUP" })}
          onReinspect={reinspect}
          onReturnToImport={onReturnToImport}
        />
      )}

      {(state.status === "backup_ready" || state.status === "backup_downloaded") && state.data && (
        <MigrationBackupStep
          downloaded={state.status === "backup_downloaded"}
          canContinue={state.data.disposition === "ready" && state.data.plan.executable}
          filename={state.filename}
          error={state.downloadError}
          onDownload={downloadBackup}
          onBackToPreview={() => dispatch({ type: "BACK_TO_PREVIEW" })}
          onContinue={enterConfirmation}
        />
      )}

      {state.status === "awaiting_confirmation" && state.data && (
        <MigrationConfirmationStep
          data={state.data}
          values={state.confirmationValues}
          readiness={readiness}
          onChange={setConfirmation}
          onStart={() => void startExecution()}
          onBack={() => dispatch({ type: "BACK_TO_BACKUP" })}
        />
      )}

      {showExecution && state.data && (
        <MigrationExecutionStep
          status={state.status}
          data={state.data}
          progress={state.executionProgress}
          canCancel={state.canCancel}
          onRequestCancel={() => dispatch({ type: "OPEN_CANCEL_DIALOG" })}
        />
      )}

      {(state.status === "completed_not_activated" || state.status === "cancelled" || state.status === "execution_failed") && (
        <MigrationExecutionResultStep
          status={state.status}
          result={state.executionResult}
          progress={state.executionProgress}
          error={state.safeError}
          closeWarning={state.closeWarning}
          onReturnToSettings={handleBackToSettings}
        />
      )}

      {state.status === "inspection_failed" && state.safeError && (
        <section className="migration-stage-card migration-failed" role="alert" data-testid="migration-inspection-failed">
          <h2>这次检查没有完成</h2>
          <p>{state.safeError.message}</p>
          <details><summary>查看安全错误码</summary><code>{state.safeError.code}</code></details>
          <div className="migration-footer-actions">
            <button className="primary-button" type="button" onClick={() => void inspectCurrentData()}>重新检查</button>
            <button className="migration-text-button" type="button" onClick={handleBackToSettings}>返回设置</button>
          </div>
        </section>
      )}

      <MigrationCancelDialog
        open={state.cancelDialogOpen}
        onContinue={() => dispatch({ type: "CLOSE_CANCEL_DIALOG" })}
        onConfirm={requestCancellation}
      />

      <p className="migration-memory-note">
        {executionActive
          ? "升级执行中请保持页面打开。Task 7C 完成前，刷新后不会自动恢复此页面。"
          : "检查结果只保留在当前页面。刷新或离开后需要重新检查。"}
      </p>
    </div>
  );
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
