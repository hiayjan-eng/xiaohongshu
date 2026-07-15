import {
  LEGACY_APP_STATE_STORAGE_KEY,
  LegacyLocalStorageSnapshotReader,
  createLegacyBackupBlob,
  createLegacyBackupFilename,
  createMigrationPreview,
  createMigrationPreviewUserSummary,
  serializeLegacyBackup,
  validateMigrationSource,
  type LegacyBackupEnvelope,
  type ReadonlyStorageLike
} from "@revival/storage-service";
import type {
  MigrationInspectionDisposition,
  MigrationInspectionProgress,
  MigrationInspectionResult,
  PreparedLegacyBackupDownload
} from "./migration-preview-types";

const TARGET_SCHEMA_VERSION = 1;
const PRODUCT_DATA_STORES = [
  "savedItems",
  "importBatches",
  "importBatchItems",
  "smartAlbums",
  "actionCards",
  "planCards",
  "classificationCorrections"
] as const;

export const MIGRATION_INSPECTION_PROGRESS: readonly MigrationInspectionProgress[] = [
  { stage: "reading_local_data", label: "正在读取本地收藏" },
  { stage: "creating_raw_backup", label: "正在生成原始备份" },
  { stage: "validating_structure", label: "正在检查数据结构" },
  { stage: "checking_preserved_data", label: "正在核对用户备注和分类" },
  { stage: "creating_preview", label: "正在生成升级预览" }
] as const;

export class MigrationFlowController {
  private currentResult?: MigrationInspectionResult;

  constructor(private readonly storage: ReadonlyStorageLike) {}

  async inspect(onProgress?: (progress: MigrationInspectionProgress) => void): Promise<MigrationInspectionResult> {
    onProgress?.(MIGRATION_INSPECTION_PROGRESS[0]);
    const reader = new LegacyLocalStorageSnapshotReader(this.storage);

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[1]);
    const envelope = await reader.createBackupEnvelope({
      appVersion: "web-task7a",
      notes: "User-initiated read-only migration inspection"
    });

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[2]);
    const sourceValidation = await validateMigrationSource(envelope, {
      targetSchemaVersion: TARGET_SCHEMA_VERSION
    });

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[3]);
    const preview = await createMigrationPreview(envelope, {
      targetSchemaVersion: TARGET_SCHEMA_VERSION,
      targetMustBeEmpty: true
    });

    onProgress?.(MIGRATION_INSPECTION_PROGRESS[4]);
    const userSummary = createMigrationPreviewUserSummary(preview);
    const hasProductData = hasLegacyProductData(envelope);
    const disposition = getInspectionDisposition(envelope, preview.summary.totalBlockingIssues, preview.summary.totalWarnings, preview.summary.totalManualReview, hasProductData);
    const result: MigrationInspectionResult = {
      disposition,
      envelope,
      sourceValidation,
      preview,
      plan: preview.plan,
      userSummary,
      rawBackupAvailable: envelope.report.canExportRawBackup,
      hasProductData
    };
    this.currentResult = result;
    return result;
  }

  getCurrentResult(): MigrationInspectionResult | undefined {
    return this.currentResult;
  }

  serializeBackup(): string {
    return serializeLegacyBackup(this.requireEnvelope());
  }

  createBackupBlob(serialized = this.serializeBackup()): Blob {
    return createLegacyBackupBlob(serialized);
  }

  createBackupFilename(): string {
    return createLegacyBackupFilename(this.requireEnvelope().createdAt);
  }

  prepareBackupDownload(): PreparedLegacyBackupDownload {
    const serialized = this.serializeBackup();
    return {
      serialized,
      blob: this.createBackupBlob(serialized),
      filename: this.createBackupFilename()
    };
  }

  private requireEnvelope(): LegacyBackupEnvelope {
    if (!this.currentResult) {
      throw new Error("Migration inspection must complete before preparing a backup download.");
    }
    return this.currentResult.envelope;
  }
}

export function createReadonlyBrowserStorage(storage?: Storage): ReadonlyStorageLike {
  const source = storage ?? globalThis.localStorage;
  if (!source) throw new Error("Browser localStorage is unavailable.");

  // This is the Task 7A read-only boundary. Do not replace it with a full Storage object.
  return {
    get length() {
      return source.length;
    },
    getItem(key: string) {
      return source.getItem(key);
    },
    key(index: number) {
      return source.key(index);
    }
  };
}

function hasLegacyProductData(envelope: LegacyBackupEnvelope): boolean {
  if (envelope.rawBackup.rawRecords[LEGACY_APP_STATE_STORAGE_KEY] === null) return false;
  const counts = envelope.normalizedSnapshot?.counts;
  if (!counts) return true;
  return PRODUCT_DATA_STORES.some((store) => (counts[store] ?? 0) > 0);
}

function getInspectionDisposition(
  envelope: LegacyBackupEnvelope,
  blockingIssueCount: number,
  warningCount: number,
  manualReviewCount: number,
  hasProductData: boolean
): MigrationInspectionDisposition {
  if (!hasProductData) return "empty";
  if (envelope.report.issues.some((issue) => issue.code === "CHECKSUM_UNAVAILABLE")) return "blocked";
  if (!envelope.normalizedSnapshot || blockingIssueCount > 0) return "blocked";
  if (warningCount > 0 || manualReviewCount > 0) return "review_required";
  return "ready";
}
