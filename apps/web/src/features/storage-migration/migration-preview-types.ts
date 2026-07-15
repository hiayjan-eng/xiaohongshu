import type {
  LegacyBackupEnvelope,
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
  | "inspection_failed";

export type MigrationInspectionStage =
  | "reading_local_data"
  | "creating_raw_backup"
  | "validating_structure"
  | "checking_preserved_data"
  | "creating_preview";

export type MigrationInspectionDisposition = "ready" | "review_required" | "blocked" | "empty";

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
}

export type MigrationPreviewDataStateName = "preview_ready" | "review_required" | "blocked";

export type MigrationPreviewUiState =
  | { status: "idle" }
  | { status: "inspecting"; progress: MigrationInspectionProgress }
  | { status: MigrationPreviewDataStateName; data: MigrationInspectionResult }
  | {
      status: "backup_ready";
      data: MigrationInspectionResult;
      previewStatus: MigrationPreviewDataStateName;
      downloadError?: MigrationUiError;
    }
  | {
      status: "backup_downloaded";
      data: MigrationInspectionResult;
      previewStatus: MigrationPreviewDataStateName;
      filename: string;
    }
  | { status: "inspection_failed"; error: MigrationUiError };

export type MigrationPreviewUiAction =
  | { type: "START_INSPECTION"; progress: MigrationInspectionProgress }
  | { type: "INSPECTION_PROGRESS"; progress: MigrationInspectionProgress }
  | { type: "INSPECTION_SUCCEEDED"; data: MigrationInspectionResult }
  | { type: "INSPECTION_FAILED"; error: MigrationUiError }
  | { type: "OPEN_BACKUP" }
  | { type: "BACK_TO_PREVIEW" }
  | { type: "BACKUP_DOWNLOAD_SUCCEEDED"; filename: string }
  | { type: "BACKUP_DOWNLOAD_FAILED"; error: MigrationUiError }
  | { type: "RESET" };

export interface PreparedLegacyBackupDownload {
  blob: Blob;
  filename: string;
  serialized: string;
}
