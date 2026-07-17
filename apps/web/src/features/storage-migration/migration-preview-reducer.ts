import type { MigrationExecutionStatus } from "@revival/storage-service";
import {
  EMPTY_MIGRATION_CONFIRMATIONS,
  type MigrationInspectionDisposition,
  type MigrationPreviewDataStateName,
  type MigrationPreviewUiAction,
  type MigrationPreviewUiState,
  type MigrationPreviewUiStateName
} from "./migration-preview-types";

export const initialMigrationPreviewUiState: MigrationPreviewUiState = {
  status: "idle",
  currentStep: 1,
  confirmationValues: { ...EMPTY_MIGRATION_CONFIRMATIONS },
  canCancel: false,
  cancelDialogOpen: false,
  resumeConfirmed: false,
  rollbackConfirmations: { clearNewStorage: false, recheckRequired: false },
  reportExpanded: false,
  recoveryRefreshing: false
};

export function migrationPreviewReducer(
  state: MigrationPreviewUiState,
  action: MigrationPreviewUiAction
): MigrationPreviewUiState {
  switch (action.type) {
    case "START_INSPECTION":
      return { ...initialMigrationPreviewUiState, status: "inspecting", inspectionProgress: action.progress };
    case "INSPECTION_PROGRESS":
      return state.status === "inspecting" ? { ...state, inspectionProgress: action.progress } : state;
    case "INSPECTION_SUCCEEDED": {
      const status = dispositionToUiStatus(action.data.disposition);
      return { ...initialMigrationPreviewUiState, status, currentStep: 2, data: action.data, previewStatus: status };
    }
    case "INSPECTION_FAILED":
      return { ...initialMigrationPreviewUiState, status: "inspection_failed", safeError: action.error, technicalErrorCode: action.error.code };
    case "OPEN_BACKUP":
      if (!isPreviewStatus(state.status) || !state.data?.rawBackupAvailable) return state;
      return {
        ...state,
        status: state.filename ? "backup_downloaded" : "backup_ready",
        currentStep: 3,
        previewStatus: state.status,
        downloadError: undefined
      };
    case "BACK_TO_PREVIEW":
      if ((state.status !== "backup_ready" && state.status !== "backup_downloaded") || !state.previewStatus) return state;
      return { ...state, status: state.previewStatus, currentStep: 2, downloadError: undefined };
    case "BACKUP_DOWNLOAD_SUCCEEDED":
      if (state.status !== "backup_ready" && state.status !== "backup_downloaded") return state;
      return { ...state, status: "backup_downloaded", currentStep: 3, filename: action.filename, downloadError: undefined };
    case "BACKUP_DOWNLOAD_FAILED":
      if (state.status !== "backup_ready" && state.status !== "backup_downloaded") return state;
      return { ...state, status: "backup_ready", currentStep: 3, downloadError: action.error };
    case "ENTER_CONFIRMATION":
      if (state.status !== "backup_downloaded" || state.data?.disposition !== "ready") return state;
      return { ...state, status: "awaiting_confirmation", currentStep: 4, confirmationValues: { ...EMPTY_MIGRATION_CONFIRMATIONS } };
    case "BACK_TO_BACKUP":
      if (state.status !== "awaiting_confirmation") return state;
      return { ...state, status: "backup_downloaded", currentStep: 3, confirmationValues: { ...EMPTY_MIGRATION_CONFIRMATIONS } };
    case "SET_CONFIRMATION":
      if (state.status !== "awaiting_confirmation") return state;
      return { ...state, confirmationValues: { ...state.confirmationValues, [action.key]: action.value } };
    case "CHECK_EXECUTION_SUPPORT":
      if (state.status !== "awaiting_confirmation") return state;
      return { ...state, status: "checking_execution_support", currentStep: 5, safeError: undefined, technicalErrorCode: undefined };
    case "OPENING_TARGET":
      return { ...state, status: "opening_target", currentStep: 5, canCancel: true };
    case "EXECUTION_PROGRESS": {
      const status = state.status === "cancelling" ? "cancelling" : progressStatusToUiState(action.progress.status);
      return {
        ...state,
        status,
        currentStep: 5,
        executionProgress: action.progress,
        canCancel: canCancelInStatus(status)
      };
    }
    case "OPEN_CANCEL_DIALOG":
      return state.canCancel ? { ...state, cancelDialogOpen: true } : state;
    case "CLOSE_CANCEL_DIALOG":
      return { ...state, cancelDialogOpen: false };
    case "CANCELLING":
      return { ...state, status: "cancelling", currentStep: 5, canCancel: false, cancelDialogOpen: false };
    case "EXECUTION_CANCELLED":
      return {
        ...state,
        status: "cancelled",
        currentStep: 5,
        canCancel: false,
        cancelDialogOpen: false,
        safeError: action.error,
        technicalErrorCode: action.error?.code,
        closeWarning: action.closeWarning
      };
    case "EXECUTION_COMPLETED":
      return {
        ...state,
        status: "completed_not_activated",
        currentStep: 5,
        canCancel: false,
        cancelDialogOpen: false,
        executionResult: action.result,
        closeWarning: action.closeWarning
      };
    case "EXECUTION_FAILED":
      return {
        ...state,
        status: "execution_failed",
        currentStep: 5,
        canCancel: false,
        cancelDialogOpen: false,
        safeError: action.error,
        technicalErrorCode: action.error.code,
        closeWarning: action.closeWarning
      };
    case "CHECK_EXISTING_SESSION":
      return { ...initialMigrationPreviewUiState, status: "checking_existing_session" };
    case "EXISTING_SESSION_RESOLVED":
      return {
        ...initialMigrationPreviewUiState,
        status: action.recovery.disposition,
        currentStep: 5,
        recovery: action.recovery,
        executionResult: action.recovery.inspection?.result
      };
    case "EXISTING_SESSION_FAILED":
      return {
        ...initialMigrationPreviewUiState,
        status: "recovery_blocked",
        recoveryError: action.error,
        recoveryTechnicalCode: action.error.code
      };
    case "SELECT_RECOVERY_ACTION":
      return {
        ...state,
        selectedAction: action.action,
        resumeConfirmed: action.action === "resume" ? false : state.resumeConfirmed,
        rollbackConfirmations: action.action === "rollback"
          ? { clearNewStorage: false, recheckRequired: false }
          : state.rollbackConfirmations
      };
    case "SET_RESUME_CONFIRMATION":
      return state.selectedAction === "resume" ? { ...state, resumeConfirmed: action.value } : state;
    case "SET_ROLLBACK_CONFIRMATION":
      return state.selectedAction === "rollback"
        ? { ...state, rollbackConfirmations: { ...state.rollbackConfirmations, [action.key]: action.value } }
        : state;
    case "START_RESUME":
      return { ...state, status: "resuming", selectedAction: undefined, canCancel: true, recoveryError: undefined };
    case "START_ROLLBACK":
      return { ...state, status: "rolling_back", selectedAction: undefined, canCancel: false, recoveryError: undefined };
    case "RECOVERY_PROGRESS":
      return {
        ...state,
        recoveryProgress: action.progress,
        status: state.status === "rolling_back" || action.progress.status === "rollback_pending" ? "rolling_back" : "resuming"
      };
    case "RECOVERY_COMPLETED":
      return {
        ...state,
        status: action.result.status === "rolled_back" ? "rolled_back" : "completed_not_activated",
        recovery: action.recovery,
        executionResult: action.result,
        canCancel: false,
        closeWarning: action.closeWarning,
        selectedAction: undefined
      };
    case "RECOVERY_CANCELLED":
      return {
        ...state,
        status: action.recovery.disposition,
        recovery: action.recovery,
        recoveryError: action.error,
        recoveryTechnicalCode: action.error?.code,
        canCancel: false,
        closeWarning: action.closeWarning
      };
    case "RECOVERY_FAILED":
      return {
        ...state,
        status: action.recovery.disposition,
        recovery: action.recovery,
        recoveryError: action.error,
        recoveryTechnicalCode: action.error.code,
        canCancel: false,
        closeWarning: action.closeWarning,
        selectedAction: undefined
      };
    case "STORED_BACKUP_DOWNLOADED":
      return { ...state, storedBackupFilename: action.filename };
    case "REPORT_DOWNLOADED":
      return { ...state, reportFilename: action.filename };
    case "TOGGLE_REPORT":
      return { ...state, reportExpanded: action.expanded ?? !state.reportExpanded };
    case "START_REFRESH_RECOVERY":
      return { ...state, recoveryRefreshing: true, recoveryError: undefined };
    case "RESET":
      return initialMigrationPreviewUiState;
  }
}

function dispositionToUiStatus(disposition: MigrationInspectionDisposition): MigrationPreviewDataStateName {
  if (disposition === "ready") return "preview_ready";
  if (disposition === "review_required") return "review_required";
  return "blocked";
}

function isPreviewStatus(status: MigrationPreviewUiStateName): status is MigrationPreviewDataStateName {
  return status === "preview_ready" || status === "review_required" || status === "blocked";
}

function progressStatusToUiState(status: MigrationExecutionStatus): MigrationPreviewUiStateName {
  if (status === "lock_acquiring") return "acquiring_lock";
  if (status === "verifying_store" || status === "verifying_all") return "verifying";
  if (status === "completed") return "completed_not_activated";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "rollback_failed") return "execution_failed";
  return "executing";
}

function canCancelInStatus(status: MigrationPreviewUiStateName): boolean {
  return status === "opening_target" || status === "acquiring_lock" || status === "executing" || status === "verifying";
}
