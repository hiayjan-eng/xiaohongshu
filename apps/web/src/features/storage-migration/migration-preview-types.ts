import type {
  LegacyBackupEnvelope,
  MigrationExecutionProgress,
  MigrationExecutionResult,
  MigrationPlan,
  MigrationPreviewReport,
  MigrationPreviewUserSummary,
  MigrationSourceValidationResult
} from "@revival/storage-service";

export type MigrationPreviewUiStateName =
  | "idle"
  | "inspecting"
  | "preview_ready"
  | "review_required"
  | "blocked"
  | "backup_ready"
  | "backup_downloaded"
  | "inspection_failed"
  | "awaiting_confirmation"
  | "checking_execution_support"
  | "opening_target"
  | "acquiring_lock"
  | "executing"
  | "cancelling"
  | "cancelled"
  | "verifying"
  | "completed_not_activated"
  | "execution_failed"
  | "checking_existing_session"
  | "existing_session_not_found"
  | "resume_available"
  | "rollback_available"
  | "resuming"
  | "rolling_back"
  | "rolled_back"
  | "rollback_failed"
  | "recovery_blocked"
  | "another_session_running";

export type MigrationInspectionStage =
  | "reading_local_data"
  | "creating_raw_backup"
  | "validating_structure"
  | "checking_preserved_data"
  | "creating_preview";

export type MigrationInspectionDisposition = "ready" | "review_required" | "blocked" | "empty";
export type MigrationPreviewDataStateName = "preview_ready" | "review_required" | "blocked";
export type MigrationStepNumber = 1 | 2 | 3 | 4 | 5;

export type MigrationConfirmationKey =
  | "legacyDataRetained"
  | "backupDownloaded"
  | "legacyStorageStillActive"
  | "activationRequiresNextPhase";

export type MigrationConfirmationValues = Record<MigrationConfirmationKey, boolean>;

export const EMPTY_MIGRATION_CONFIRMATIONS: MigrationConfirmationValues = {
  legacyDataRetained: false,
  backupDownloaded: false,
  legacyStorageStillActive: false,
  activationRequiresNextPhase: false
};

export interface MigrationInspectionProgress {
  stage: MigrationInspectionStage;
  label: string;
}

export interface MigrationInspectionResult {
  disposition: MigrationInspectionDisposition;
  envelope: LegacyBackupEnvelope;
  sourceValidation: MigrationSourceValidationResult;
  preview: MigrationPreviewReport;
  plan: MigrationPlan;
  userSummary: MigrationPreviewUserSummary;
  rawBackupAvailable: boolean;
  hasProductData: boolean;
}

export interface MigrationUiError {
  code: string;
  message: string;
  recoverable?: boolean;
}

export interface MigrationPreviewUiState {
  status: MigrationPreviewUiStateName;
  currentStep: MigrationStepNumber;
  data?: MigrationInspectionResult;
  previewStatus?: MigrationPreviewDataStateName;
  inspectionProgress?: MigrationInspectionProgress;
  filename?: string;
  downloadError?: MigrationUiError;
  confirmationValues: MigrationConfirmationValues;
  executionProgress?: MigrationExecutionProgress;
  executionResult?: MigrationExecutionResult;
  safeError?: MigrationUiError;
  technicalErrorCode?: string;
  canCancel: boolean;
  cancelDialogOpen: boolean;
  closeWarning?: string;
  recovery?: import("./migration-recovery-controller").MigrationRecoveryInspectionResult;
  recoveryProgress?: MigrationExecutionProgress;
  recoveryError?: MigrationUiError;
  recoveryTechnicalCode?: string;
  selectedAction?: "resume" | "rollback" | "report";
  resumeConfirmed: boolean;
  rollbackConfirmations: {
    clearNewStorage: boolean;
    recheckRequired: boolean;
  };
  reportExpanded: boolean;
  storedBackupFilename?: string;
  reportFilename?: string;
  recoveryRefreshing: boolean;
}

export type MigrationPreviewUiAction =
  | { type: "START_INSPECTION"; progress: MigrationInspectionProgress }
  | { type: "INSPECTION_PROGRESS"; progress: MigrationInspectionProgress }
  | { type: "INSPECTION_SUCCEEDED"; data: MigrationInspectionResult }
  | { type: "INSPECTION_FAILED"; error: MigrationUiError }
  | { type: "OPEN_BACKUP" }
  | { type: "BACK_TO_PREVIEW" }
  | { type: "BACKUP_DOWNLOAD_SUCCEEDED"; filename: string }
  | { type: "BACKUP_DOWNLOAD_FAILED"; error: MigrationUiError }
  | { type: "ENTER_CONFIRMATION" }
  | { type: "BACK_TO_BACKUP" }
  | { type: "SET_CONFIRMATION"; key: MigrationConfirmationKey; value: boolean }
  | { type: "CHECK_EXECUTION_SUPPORT" }
  | { type: "OPENING_TARGET" }
  | { type: "EXECUTION_PROGRESS"; progress: MigrationExecutionProgress }
  | { type: "OPEN_CANCEL_DIALOG" }
  | { type: "CLOSE_CANCEL_DIALOG" }
  | { type: "CANCELLING" }
  | { type: "EXECUTION_CANCELLED"; error?: MigrationUiError; closeWarning?: string }
  | { type: "EXECUTION_COMPLETED"; result: MigrationExecutionResult; closeWarning?: string }
  | { type: "EXECUTION_FAILED"; error: MigrationUiError; closeWarning?: string }
  | { type: "CHECK_EXISTING_SESSION" }
  | { type: "EXISTING_SESSION_RESOLVED"; recovery: import("./migration-recovery-controller").MigrationRecoveryInspectionResult }
  | { type: "EXISTING_SESSION_FAILED"; error: MigrationUiError }
  | { type: "SELECT_RECOVERY_ACTION"; action?: "resume" | "rollback" | "report" }
  | { type: "SET_RESUME_CONFIRMATION"; value: boolean }
  | { type: "SET_ROLLBACK_CONFIRMATION"; key: "clearNewStorage" | "recheckRequired"; value: boolean }
  | { type: "START_RESUME" }
  | { type: "START_ROLLBACK" }
  | { type: "RECOVERY_PROGRESS"; progress: MigrationExecutionProgress }
  | { type: "RECOVERY_COMPLETED"; result: MigrationExecutionResult; recovery: import("./migration-recovery-controller").MigrationRecoveryInspectionResult; closeWarning?: string }
  | { type: "RECOVERY_CANCELLED"; recovery: import("./migration-recovery-controller").MigrationRecoveryInspectionResult; error?: MigrationUiError; closeWarning?: string }
  | { type: "RECOVERY_FAILED"; recovery: import("./migration-recovery-controller").MigrationRecoveryInspectionResult; error: MigrationUiError; closeWarning?: string }
  | { type: "STORED_BACKUP_DOWNLOADED"; filename: string }
  | { type: "REPORT_DOWNLOADED"; filename: string }
  | { type: "TOGGLE_REPORT"; expanded?: boolean }
  | { type: "START_REFRESH_RECOVERY" }
  | { type: "RESET" };

export interface PreparedLegacyBackupDownload {
  blob: Blob;
  filename: string;
  serialized: string;
}

export interface MigrationExecutionReadiness {
  ready: boolean;
  reason?: string;
}
