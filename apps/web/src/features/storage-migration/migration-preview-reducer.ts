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
  cancelDialogOpen: false
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
      return { ...state, status: "backup_ready", currentStep: 3, previewStatus: state.status, downloadError: undefined };
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
