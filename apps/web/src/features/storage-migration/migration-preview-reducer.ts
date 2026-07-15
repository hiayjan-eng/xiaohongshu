import type {
  MigrationInspectionDisposition,
  MigrationPreviewDataStateName,
  MigrationPreviewUiAction,
  MigrationPreviewUiState
} from "./migration-preview-types";

export const initialMigrationPreviewUiState: MigrationPreviewUiState = { status: "idle" };

export function migrationPreviewReducer(
  state: MigrationPreviewUiState,
  action: MigrationPreviewUiAction
): MigrationPreviewUiState {
  switch (action.type) {
    case "START_INSPECTION":
      return { status: "inspecting", progress: action.progress };
    case "INSPECTION_PROGRESS":
      return state.status === "inspecting" ? { ...state, progress: action.progress } : state;
    case "INSPECTION_SUCCEEDED":
      return {
        status: dispositionToUiStatus(action.data.disposition),
        data: action.data
      };
    case "INSPECTION_FAILED":
      return { status: "inspection_failed", error: action.error };
    case "OPEN_BACKUP": {
      if (!isPreviewState(state) || !state.data.rawBackupAvailable) return state;
      return {
        status: "backup_ready",
        data: state.data,
        previewStatus: state.status
      };
    }
    case "BACK_TO_PREVIEW":
      if (state.status !== "backup_ready" && state.status !== "backup_downloaded") return state;
      return { status: state.previewStatus, data: state.data };
    case "BACKUP_DOWNLOAD_SUCCEEDED":
      if (state.status !== "backup_ready" && state.status !== "backup_downloaded") return state;
      return {
        status: "backup_downloaded",
        data: state.data,
        previewStatus: state.previewStatus,
        filename: action.filename
      };
    case "BACKUP_DOWNLOAD_FAILED":
      if (state.status !== "backup_ready" && state.status !== "backup_downloaded") return state;
      return {
        status: "backup_ready",
        data: state.data,
        previewStatus: state.previewStatus,
        downloadError: action.error
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

function isPreviewState(
  state: MigrationPreviewUiState
): state is Extract<MigrationPreviewUiState, { status: MigrationPreviewDataStateName }> {
  return state.status === "preview_ready" || state.status === "review_required" || state.status === "blocked";
}
