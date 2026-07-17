import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { useEffect, useReducer, useRef } from "react";
import { MigrationBackupStep, triggerPreparedBackupDownload } from "./MigrationBackupStep";
import { MigrationCancelDialog } from "./MigrationCancelDialog";
import { MigrationConfirmationStep } from "./MigrationConfirmationStep";
import { MigrationExecutionResultStep } from "./MigrationExecutionResultStep";
import { MigrationExecutionStep } from "./MigrationExecutionStep";
import { MigrationInspectionStep } from "./MigrationInspectionStep";
import { MigrationPreviewStep } from "./MigrationPreviewStep";
import { MigrationRecoveryOverview } from "./MigrationRecoveryOverview";
import { MigrationRecoveryProgress } from "./MigrationRecoveryProgress";
import { MigrationResumeConfirmation, MigrationRollbackConfirmation } from "./MigrationRecoveryConfirmations";
import {
  MigrationFlowController,
  createReadonlyBrowserStorage,
  MIGRATION_INSPECTION_PROGRESS,
  type MigrationControllerLifecycleEvent
} from "./migration-flow-controller";
import {
  MigrationRecoveryController,
  type MigrationRecoveryLifecycleEvent
} from "./migration-recovery-controller";
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
  "verifying",
  "resuming",
  "rolling_back"
]);

const RECOVERY_OVERVIEW_STATES = new Set<MigrationPreviewUiStateName>([
  "resume_available",
  "rollback_available",
  "rollback_failed",
  "rolled_back",
  "recovery_blocked",
  "another_session_running",
  "completed_not_activated"
]);

export function MigrationDataUpgradePage({
  onBackToSettings,
  onReturnToImport,
  onExecutionActiveChange
}: MigrationDataUpgradePageProps) {
  const [state, dispatch] = useReducer(migrationPreviewReducer, initialMigrationPreviewUiState);
  const controllerRef = useRef<MigrationFlowController | null>(null);
  const recoveryControllerRef = useRef<MigrationRecoveryController | null>(null);
  const existingSessionCheckedRef = useRef(false);
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

  useEffect(() => {
    if (existingSessionCheckedRef.current) return;
    existingSessionCheckedRef.current = true;
    void inspectExistingSession();
  }, []);

  async function inspectExistingSession() {
    dispatch({ type: "CHECK_EXISTING_SESSION" });
    try {
      const controller = recoveryControllerRef.current ?? new MigrationRecoveryController();
      recoveryControllerRef.current = controller;
      const recovery = await controller.inspectExistingSession();
      dispatch({ type: "EXISTING_SESSION_RESOLVED", recovery });
    } catch (error) {
      dispatch({ type: "EXISTING_SESSION_FAILED", error: toSafeMigrationUiError(error) });
    }
  }

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
      const recovery = await requireRecoveryController().inspectExistingSession();
      dispatch({ type: "RECOVERY_COMPLETED", result: outcome.result, recovery, closeWarning: controller.getCloseWarning() });
    } catch (error) {
      const safeError = toSafeMigrationUiError(error);
      const recovery = await safelyInspectRecovery(safeError);
      if (safeError.code === "MIGRATION_CANCELLED" && recovery?.inspection) dispatch({ type: "RECOVERY_CANCELLED", recovery, error: safeError, closeWarning: controller.getCloseWarning() });
      else if (recovery?.inspection) dispatch({ type: "RECOVERY_FAILED", recovery, error: safeError, closeWarning: controller.getCloseWarning() });
      else dispatch({ type: "EXECUTION_FAILED", error: safeError, closeWarning: controller.getCloseWarning() });
    }
  }

  function handleLifecycleEvent(event: MigrationControllerLifecycleEvent) {
    if (event.type === "checking_execution_support") dispatch({ type: "CHECK_EXECUTION_SUPPORT" });
    if (event.type === "opening_target") dispatch({ type: "OPENING_TARGET" });
    if (event.type === "progress") dispatch({ type: "EXECUTION_PROGRESS", progress: event.progress });
  }

  function requestCancellation() {
    if (controllerRef.current?.requestCancellation() || recoveryControllerRef.current?.requestResumeCancellation()) {
      dispatch({ type: "CANCELLING" });
    }
  }

  function reinspect() {
    controllerRef.current = null;
    void inspectCurrentData();
  }

  async function refreshRecovery() {
    dispatch({ type: "START_REFRESH_RECOVERY" });
    await inspectExistingSession();
  }

  async function resumeMigration() {
    const inspection = state.recovery?.inspection;
    if (!inspection) return;
    dispatch({ type: "START_RESUME" });
    try {
      await waitForNextPaint();
      const result = await requireRecoveryController().resumeMigration(inspection, state.resumeConfirmed, handleRecoveryLifecycle);
      const recovery = await requireRecoveryController().inspectExistingSession();
      dispatch({ type: "RECOVERY_COMPLETED", result, recovery, closeWarning: requireRecoveryController().getCloseWarning() });
    } catch (error) {
      await handleRecoveryFailure(error);
    }
  }

  async function rollbackMigration() {
    const inspection = state.recovery?.inspection;
    if (!inspection) return;
    dispatch({ type: "START_ROLLBACK" });
    try {
      await waitForNextPaint();
      const result = await requireRecoveryController().rollbackMigration(inspection, state.rollbackConfirmations, handleRecoveryLifecycle);
      const recovery = await requireRecoveryController().inspectExistingSession();
      dispatch({ type: "RECOVERY_COMPLETED", result, recovery, closeWarning: requireRecoveryController().getCloseWarning() });
    } catch (error) {
      await handleRecoveryFailure(error);
    }
  }

  async function handleRecoveryFailure(error: unknown) {
    const safeError = toSafeMigrationUiError(error);
    const inspected = await safelyInspectRecovery(safeError);
    if (!inspected) {
      dispatch({ type: "EXISTING_SESSION_FAILED", error: safeError });
      return;
    }
    const recovery = safeError.code === "MIGRATION_RESUME_CONFLICT"
      ? { ...inspected, disposition: "recovery_blocked" as const, reason: safeError.message }
      : inspected;
    if (safeError.code === "MIGRATION_CANCELLED") {
      dispatch({ type: "RECOVERY_CANCELLED", recovery, error: safeError, closeWarning: requireRecoveryController().getCloseWarning() });
    } else {
      dispatch({ type: "RECOVERY_FAILED", recovery, error: safeError, closeWarning: requireRecoveryController().getCloseWarning() });
    }
  }

  function handleRecoveryLifecycle(event: MigrationRecoveryLifecycleEvent) {
    if (event.type === "progress" && event.progress) dispatch({ type: "RECOVERY_PROGRESS", progress: event.progress });
  }

  async function downloadStoredBackup() {
    const migrationId = state.recovery?.inspection?.migrationId;
    if (!migrationId) return;
    try {
      const prepared = await requireRecoveryController().prepareStoredBackupDownload(migrationId);
      triggerPreparedBackupDownload(prepared);
      dispatch({ type: "STORED_BACKUP_DOWNLOADED", filename: prepared.filename });
    } catch (error) {
      dispatch({ type: "RECOVERY_FAILED", recovery: state.recovery!, error: toSafeMigrationUiError(error) });
    }
  }

  function downloadRecoveryReport() {
    const inspection = state.recovery?.inspection;
    if (!inspection) return;
    try {
      const prepared = requireRecoveryController().prepareReportDownload(inspection);
      triggerPreparedBackupDownload(prepared);
      dispatch({ type: "REPORT_DOWNLOADED", filename: prepared.filename });
    } catch (error) {
      dispatch({ type: "RECOVERY_FAILED", recovery: state.recovery!, error: toSafeMigrationUiError(error) });
    }
  }

  async function safelyInspectRecovery(error: { code: string; message: string }) {
    try {
      return await requireRecoveryController().inspectExistingSession();
    } catch {
      void error;
      return undefined;
    }
  }

  function requireRecoveryController() {
    const controller = recoveryControllerRef.current ?? new MigrationRecoveryController();
    recoveryControllerRef.current = controller;
    return controller;
  }

  function handleBackToSettings() {
    if (executionActive && !window.confirm("当前操作仍在进行。离开页面不会切换新存储，但可能需要稍后继续处理。确定仍然离开吗？")) return;
    onBackToSettings();
  }

  const showExecution = ACTIVE_EXECUTION_STATES.has(state.status);
  const recoveryReport = state.recovery?.inspection
    ? requireRecoveryController().createReport(state.recovery.inspection)
    : undefined;
  const showRecoveryOverview = RECOVERY_OVERVIEW_STATES.has(state.status) && Boolean(state.recovery) && !state.selectedAction;
  const showWizard = !state.recovery && state.status !== "checking_existing_session" && state.status !== "recovery_blocked";

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

      {showWizard && (
        <>
          <div className="migration-mobile-step" aria-live="polite">第 {state.currentStep} / 5 步 · {STEPS[state.currentStep - 1]}</div>
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
        </>
      )}

      {state.status === "checking_existing_session" && (
        <section className="migration-stage-card migration-existing-session-check" aria-live="polite" data-testid="checking-existing-migration-session">
          <h2>正在检查上一次升级状态</h2>
          <p>这里只会读取新存储中的升级记录，不会继续或恢复数据。</p>
        </section>
      )}

      {(state.status === "idle" || state.status === "existing_session_not_found" || state.status === "inspecting") && (
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

      {showRecoveryOverview && state.recovery && (
        <MigrationRecoveryOverview
          recovery={state.recovery}
          report={recoveryReport}
          reportExpanded={state.reportExpanded}
          reportFilename={state.reportFilename}
          storedBackupFilename={state.storedBackupFilename}
          refreshing={state.recoveryRefreshing}
          error={state.recoveryError}
          onResume={() => dispatch({ type: "SELECT_RECOVERY_ACTION", action: "resume" })}
          onRollback={() => dispatch({ type: "SELECT_RECOVERY_ACTION", action: "rollback" })}
          onReinspectLegacy={() => void inspectCurrentData()}
          onRefresh={() => void refreshRecovery()}
          onDownloadBackup={() => void downloadStoredBackup()}
          onToggleReport={() => dispatch({ type: "TOGGLE_REPORT" })}
          onDownloadReport={downloadRecoveryReport}
          onReturnToSettings={handleBackToSettings}
        />
      )}

      {state.selectedAction === "resume" && state.recovery?.inspection && (
        <MigrationResumeConfirmation
          inspection={state.recovery.inspection}
          confirmed={state.resumeConfirmed}
          onChange={(value) => dispatch({ type: "SET_RESUME_CONFIRMATION", value })}
          onCancel={() => dispatch({ type: "SELECT_RECOVERY_ACTION" })}
          onConfirm={() => void resumeMigration()}
        />
      )}

      {state.selectedAction === "rollback" && state.recovery?.inspection && (
        <MigrationRollbackConfirmation
          inspection={state.recovery.inspection}
          values={state.rollbackConfirmations}
          onChange={(key, value) => dispatch({ type: "SET_ROLLBACK_CONFIRMATION", key, value })}
          onCancel={() => dispatch({ type: "SELECT_RECOVERY_ACTION" })}
          onConfirm={() => void rollbackMigration()}
        />
      )}

      {(state.status === "resuming" || state.status === "rolling_back" || (state.status === "cancelling" && state.recovery)) && state.recovery?.inspection && (
        <MigrationRecoveryProgress
          operation={state.status === "rolling_back" ? "rollback" : "resume"}
          inspection={state.recovery.inspection}
          progress={state.recoveryProgress}
          canCancel={state.status !== "cancelling" && state.status !== "rolling_back"}
          onCancel={() => dispatch({ type: "OPEN_CANCEL_DIALOG" })}
        />
      )}

      {!state.recovery && (state.status === "completed_not_activated" || state.status === "cancelled" || state.status === "execution_failed") && (
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
          ? "当前操作仍在进行。离开不会切换新存储，但可能需要稍后继续处理。"
          : state.recovery
            ? "刷新页面只会重新检查升级记录，不会自动继续或恢复。"
            : "检查结果只保留在当前页面。刷新或离开后需要重新检查。"}
      </p>
    </div>
  );
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
