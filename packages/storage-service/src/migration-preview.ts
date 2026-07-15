import type {
  ActionCard,
  ClassificationCorrection,
  ImportBatch,
  ImportBatchItem,
  PlanCard,
  SavedItem,
  SmartAlbum
} from "@revival/shared-types";
import {
  STORAGE_ENTITY_NAMES,
  STORE_PRIMARY_KEYS,
  type StorageAdapter,
  type StorageEntityName,
  type StoragePrimaryKey,
  type StorageRecordMap,
  type StorageSnapshot
} from "./contracts";
import { StorageError } from "./errors";
import { canonicalJsonStringify, cloneJsonSafe } from "./json-utils";
import {
  LEGACY_APP_STATE_STORAGE_KEY,
  type LegacyBackupEnvelope,
  type LegacySnapshotIssue,
  verifyLegacyBackupEnvelope
} from "./legacy-localstorage-snapshot";

export type MigrationIssueSeverity = "blocking" | "warning" | "info";

export type MigrationIssueScope =
  | "envelope"
  | "rawBackup"
  | "snapshot"
  | "store"
  | "record"
  | "reference"
  | "duplicate"
  | "preservation"
  | "target"
  | "migration";

export type MigrationIssueCode =
  | "BACKUP_ENVELOPE_INVALID"
  | "RAW_BACKUP_MISSING"
  | "RAW_CHECKSUM_MISMATCH"
  | "NORMALIZED_SNAPSHOT_MISSING"
  | "NORMALIZED_CHECKSUM_MISMATCH"
  | "UNSUPPORTED_BACKUP_FORMAT"
  | "UNSUPPORTED_SNAPSHOT_FORMAT"
  | "UNSUPPORTED_SOURCE_SCHEMA"
  | "UNSUPPORTED_TARGET_SCHEMA"
  | "COUNT_MISMATCH"
  | "STORE_NOT_SUPPORTED"
  | "STORE_RECORDS_INVALID"
  | "MISSING_PRIMARY_KEY"
  | "DUPLICATE_PRIMARY_KEY"
  | "INVALID_RECORD_SHAPE"
  | "INVALID_DATE"
  | "INVALID_STATUS"
  | "BROKEN_REQUIRED_REFERENCE"
  | "BROKEN_OPTIONAL_REFERENCE"
  | "SOURCE_IDENTITY_DUPLICATE"
  | "NORMALIZED_URL_DUPLICATE"
  | "SOURCE_ITEM_ID_DUPLICATE"
  | "TARGET_RECORD_IDENTICAL"
  | "TARGET_RECORD_CONFLICT"
  | "TARGET_NOT_EMPTY"
  | "USER_NOTE_NOT_PRESERVED"
  | "USER_EDITED_TITLE_NOT_PRESERVED"
  | "SOURCE_URL_NOT_PRESERVED"
  | "MANUAL_CLASSIFICATION_NOT_PRESERVED"
  | "MANUAL_ALBUM_MEMBERSHIP_NOT_PRESERVED"
  | "ALBUM_STATUS_NOT_PRESERVED"
  | "ACTION_CARD_CONTENT_NOT_PRESERVED"
  | "PLAN_CARD_STATE_NOT_PRESERVED"
  | "CLASSIFICATION_CORRECTION_NOT_PRESERVED"
  | "THEME_NOT_PRESERVED"
  | "ACHIEVEMENT_NOT_PRESERVED"
  | "INTERNAL_DATA_EXCLUDED"
  | "DERIVED_DATA_WILL_REBUILD"
  | "TEXT_REPAIR_PENDING"
  | "REQUIRES_MANUAL_REVIEW"
  | "MIGRATION_BLOCKED";

export const MIGRATION_ISSUE_SEVERITY: Readonly<Record<MigrationIssueCode, MigrationIssueSeverity>> = {
  BACKUP_ENVELOPE_INVALID: "blocking",
  RAW_BACKUP_MISSING: "blocking",
  RAW_CHECKSUM_MISMATCH: "blocking",
  NORMALIZED_SNAPSHOT_MISSING: "blocking",
  NORMALIZED_CHECKSUM_MISMATCH: "blocking",
  UNSUPPORTED_BACKUP_FORMAT: "blocking",
  UNSUPPORTED_SNAPSHOT_FORMAT: "blocking",
  UNSUPPORTED_SOURCE_SCHEMA: "blocking",
  UNSUPPORTED_TARGET_SCHEMA: "blocking",
  COUNT_MISMATCH: "blocking",
  STORE_NOT_SUPPORTED: "blocking",
  STORE_RECORDS_INVALID: "blocking",
  MISSING_PRIMARY_KEY: "blocking",
  DUPLICATE_PRIMARY_KEY: "blocking",
  INVALID_RECORD_SHAPE: "warning",
  INVALID_DATE: "warning",
  INVALID_STATUS: "warning",
  BROKEN_REQUIRED_REFERENCE: "blocking",
  BROKEN_OPTIONAL_REFERENCE: "warning",
  SOURCE_IDENTITY_DUPLICATE: "warning",
  NORMALIZED_URL_DUPLICATE: "warning",
  SOURCE_ITEM_ID_DUPLICATE: "warning",
  TARGET_RECORD_IDENTICAL: "info",
  TARGET_RECORD_CONFLICT: "warning",
  TARGET_NOT_EMPTY: "info",
  USER_NOTE_NOT_PRESERVED: "blocking",
  USER_EDITED_TITLE_NOT_PRESERVED: "blocking",
  SOURCE_URL_NOT_PRESERVED: "blocking",
  MANUAL_CLASSIFICATION_NOT_PRESERVED: "blocking",
  MANUAL_ALBUM_MEMBERSHIP_NOT_PRESERVED: "warning",
  ALBUM_STATUS_NOT_PRESERVED: "warning",
  ACTION_CARD_CONTENT_NOT_PRESERVED: "warning",
  PLAN_CARD_STATE_NOT_PRESERVED: "warning",
  CLASSIFICATION_CORRECTION_NOT_PRESERVED: "blocking",
  THEME_NOT_PRESERVED: "warning",
  ACHIEVEMENT_NOT_PRESERVED: "warning",
  INTERNAL_DATA_EXCLUDED: "info",
  DERIVED_DATA_WILL_REBUILD: "info",
  TEXT_REPAIR_PENDING: "warning",
  REQUIRES_MANUAL_REVIEW: "warning",
  MIGRATION_BLOCKED: "blocking"
};

export interface MigrationIssue {
  id: string;
  code: MigrationIssueCode;
  severity: MigrationIssueSeverity;
  scope: MigrationIssueScope;
  store?: StorageEntityName;
  recordId?: StoragePrimaryKey;
  field?: string;
  relatedStore?: StorageEntityName;
  relatedRecordId?: StoragePrimaryKey;
  message: string;
  userMessage: string;
  recoverable: boolean;
  requiresManualReview: boolean;
}

export interface MigrationStorePreview {
  store: StorageEntityName;
  sourceCount: number;
  validCount: number;
  invalidCount: number;
  duplicatePrimaryKeyCount: number;
  identityDuplicateCount: number;
  brokenReferenceCount: number;
  manualReviewCount: number;
  plannedCreateCount: number;
  plannedUpdateCount: number;
  plannedSkipCount: number;
  plannedConflictCount: number;
  estimatedBytes: number;
}

export interface MigrationPreviewSummary {
  totalSourceRecords: number;
  totalValidRecords: number;
  totalInvalidRecords: number;
  totalBlockingIssues: number;
  totalWarnings: number;
  totalInfo: number;
  totalManualReview: number;
  canProceed: boolean;
  rawBackupAvailable: boolean;
  rollbackAvailable: boolean;
  estimatedWorkload: "small" | "medium" | "large" | "very_large";
  estimatedDurationLabel: string;
}

export interface DataPreservationCheck {
  id: string;
  store: StorageEntityName | "rawBackup";
  recordId?: StoragePrimaryKey;
  field: string;
  status: "passed" | "failed" | "cannot_verify";
  issueId?: string;
}

export interface MigrationDuplicateGroup {
  id: string;
  store: StorageEntityName;
  field: "id" | "sourceItemId" | "normalizedSourceUrl";
  valueFingerprint: string;
  recordIds: StoragePrimaryKey[];
  issueCode: MigrationIssueCode;
}

export interface MigrationBrokenReference {
  id: string;
  store: StorageEntityName;
  recordId: StoragePrimaryKey;
  field: string;
  relatedStore: StorageEntityName;
  relatedRecordId: StoragePrimaryKey;
  required: boolean;
  issueId: string;
}

export type MigrationOperationType = "create" | "update" | "skip" | "conflict" | "manual_review";

export interface MigrationRecordOperation {
  store: StorageEntityName;
  recordId: StoragePrimaryKey;
  operation: MigrationOperationType;
  reasonCode: MigrationIssueCode | "VALID_NEW_RECORD";
  sourceChecksum?: string;
  targetChecksum?: string;
}

export interface MigrationStorePlan {
  store: StorageEntityName;
  operations: MigrationRecordOperation[];
  createCount: number;
  updateCount: number;
  skipCount: number;
  conflictCount: number;
  manualReviewCount: number;
}

export interface MigrationPlan {
  planVersion: number;
  migrationId: string;
  sourceBackupId: string;
  sourceSnapshotChecksum?: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  generatedAt: string;
  executable: boolean;
  requiredStores: StorageEntityName[];
  storePlans: Partial<Record<StorageEntityName, MigrationStorePlan>>;
  blockingIssueIds: string[];
  warningIssueIds: string[];
  requiresUserConfirmation: boolean;
  expectedSourceCounts: Partial<Record<StorageEntityName, number>>;
  expectedWriteCounts: Partial<Record<StorageEntityName, number>>;
  targetMustBeEmpty: boolean;
}

export interface MigrationPreviewReport {
  reportVersion: number;
  migrationId: string;
  generatedAt: string;
  sourceStorage: "legacy-localStorage";
  targetStorage: "indexedDB";
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  backupId: string;
  rawChecksum?: string;
  normalizedChecksum?: string;
  summary: MigrationPreviewSummary;
  stores: Partial<Record<StorageEntityName, MigrationStorePreview>>;
  issues: MigrationIssue[];
  issueCountsByCode: Partial<Record<MigrationIssueCode, number>>;
  preservationChecks: DataPreservationCheck[];
  duplicateGroups: MigrationDuplicateGroup[];
  brokenReferences: MigrationBrokenReference[];
  plan: MigrationPlan;
}

export interface MigrationReport {
  reportVersion: number;
  migrationId: string;
  planVersion: number;
  sourceBackupId: string;
  sourceSchemaVersion: number;
  targetSchemaVersion: number;
  previewGeneratedAt: string;
  status: "preview_ready" | "blocked" | "review_required";
  sourceCounts: Partial<Record<StorageEntityName, number>>;
  plannedCounts: Partial<Record<StorageEntityName, number>>;
  blockingIssueCount: number;
  warningCount: number;
  manualReviewCount: number;
  rawChecksum?: string;
  normalizedChecksum?: string;
  rollbackAvailable: boolean;
  executable: boolean;
}

export interface MigrationPreviewUserSummary {
  headline: string;
  description: string;
  counts: {
    savedItems: number;
    importBatches: number;
    smartAlbums: number;
    actionCards: number;
    planCards: number;
    corrections: number;
  };
  canProceed: boolean;
  blockingMessage?: string;
  warnings: string[];
  preservedHighlights: string[];
  excludedDataNotes: string[];
  estimatedDurationLabel: string;
  nextStep: "ready_to_migrate" | "review_required" | "backup_invalid" | "snapshot_invalid" | "unsupported_version";
}

export interface MigrationPreviewOptions {
  now?: () => Date;
  createMigrationId?: () => string;
  targetAdapter?: Pick<StorageAdapter, "getAll">;
  targetMustBeEmpty?: boolean;
  targetSchemaVersion?: number;
  detailLimit?: number;
}

export interface MigrationSourceValidationResult {
  valid: boolean;
  issues: MigrationIssue[];
  normalizedSnapshot?: StorageSnapshot;
}

const MIGRATION_REPORT_VERSION = 1;
const MIGRATION_PLAN_VERSION = 1;
const DEFAULT_TARGET_SCHEMA_VERSION = 1;
const DEFAULT_DETAIL_LIMIT = 100;
const SUPPORTED_BACKUP_FORMAT_VERSION = 1;
const SUPPORTED_SNAPSHOT_FORMAT_VERSION = 1;
const SUPPORTED_SOURCE_SCHEMA_MAX = 3;
const SKIPPED_STORES = new Set<StorageEntityName>(["migrationMetadata", "backups"]);
const ITEM_STATUSES = new Set(["not_started", "today", "in_progress", "completed", "snoozed"]);
const IMPORT_BATCH_STATUSES = new Set(["pending", "processing", "completed", "failed", "partially_completed"]);
const IMPORT_BATCH_ITEM_STATUSES = new Set(["pending", "imported", "duplicate", "failed", "skipped"]);
const ALBUM_STATUSES = new Set(["candidate", "confirmed", "archived"]);
const PLAN_CARD_STATUSES = new Set(["planned", "doing", "done", "cancelled"]);
const SETTING_CATEGORIES = new Set(["product", "appearance", "storage", "migration", "internal"]);

interface ValidationContext {
  migrationId: string;
  generatedAt: string;
  detailLimit: number;
  issues: MigrationIssue[];
  issueCountsByCode: Partial<Record<MigrationIssueCode, number>>;
  storePreviews: Partial<Record<StorageEntityName, MigrationStorePreview>>;
  duplicateGroups: MigrationDuplicateGroup[];
  brokenReferences: MigrationBrokenReference[];
  preservationChecks: DataPreservationCheck[];
  recordIssueIds: Map<string, Set<string>>;
  recordManualReviewIds: Map<string, Set<string>>;
  issueSequence: number;
}

type SnapshotRecords = Partial<{
  [K in StorageEntityName]: StorageRecordMap[K][];
}>;

export async function validateMigrationSource(envelope: LegacyBackupEnvelope, options: MigrationPreviewOptions = {}): Promise<MigrationSourceValidationResult> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const context = createValidationContext(options.createMigrationId?.() ?? "migration_preview_validation", generatedAt, options.detailLimit);

  if (!isPlainRecord(envelope)) {
    addIssue(context, {
      code: "BACKUP_ENVELOPE_INVALID",
      scope: "envelope",
      message: "Backup envelope is not an object.",
      userMessage: "备份文件格式无法识别，暂时不能继续升级。"
    });
    return { valid: false, issues: context.issues };
  }

  if (envelope.formatVersion !== SUPPORTED_BACKUP_FORMAT_VERSION || envelope.source !== "legacy-localStorage") {
    addIssue(context, {
      code: "UNSUPPORTED_BACKUP_FORMAT",
      scope: "envelope",
      message: "Backup envelope formatVersion or source is unsupported.",
      userMessage: "这份备份的格式版本暂不支持迁移。"
    });
  }
  if (!isPlainRecord(envelope.rawBackup)) {
    addIssue(context, {
      code: "RAW_BACKUP_MISSING",
      scope: "rawBackup",
      message: "Raw backup is missing.",
      userMessage: "没有找到原始备份，不能安全升级。"
    });
  }
  if (!envelope.normalizedSnapshot) {
    addIssue(context, {
      code: "NORMALIZED_SNAPSHOT_MISSING",
      scope: "snapshot",
      message: "Normalized StorageSnapshot is missing.",
      userMessage: "没有生成可迁移的数据快照，需要先重新创建备份。"
    });
  }

  try {
    const verification = await verifyLegacyBackupEnvelope(envelope);
    if (verification.rawChecksumValid === false) {
      addIssue(context, {
        code: "RAW_CHECKSUM_MISMATCH",
        scope: "rawBackup",
        message: "Raw backup checksum mismatch.",
        userMessage: "原始备份校验没有通过，不能继续升级。"
      });
    }
    if (verification.normalizedChecksumValid === false) {
      addIssue(context, {
        code: "NORMALIZED_CHECKSUM_MISMATCH",
        scope: "snapshot",
        message: "Normalized Snapshot checksum mismatch.",
        userMessage: "迁移快照校验没有通过，不能继续升级。"
      });
    }
  } catch {
    addIssue(context, {
      code: "BACKUP_ENVELOPE_INVALID",
      scope: "envelope",
      message: "Backup envelope verification failed.",
      userMessage: "备份校验过程失败，暂时不能继续升级。"
    });
  }

  for (const legacyIssue of envelope.report?.issues ?? []) {
    mapLegacyIssue(context, legacyIssue);
  }

  const snapshot = envelope.normalizedSnapshot;
  if (snapshot) validateSnapshotBasics(context, snapshot, options.targetSchemaVersion ?? DEFAULT_TARGET_SCHEMA_VERSION);

  return {
    valid: context.issues.every((issue) => issue.severity !== "blocking"),
    issues: context.issues,
    normalizedSnapshot: snapshot
  };
}

export async function createMigrationPreview(envelope: LegacyBackupEnvelope, options: MigrationPreviewOptions = {}): Promise<MigrationPreviewReport> {
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const migrationId = options.createMigrationId?.() ?? createDefaultMigrationId(generatedAt);
  const detailLimit = options.detailLimit ?? DEFAULT_DETAIL_LIMIT;
  const targetSchemaVersion = options.targetSchemaVersion ?? DEFAULT_TARGET_SCHEMA_VERSION;
  const context = createValidationContext(migrationId, generatedAt, detailLimit);

  await appendSourceValidation(context, envelope, targetSchemaVersion);
  const snapshot = envelope.normalizedSnapshot;
  if (snapshot) {
    validateSnapshotStores(context, snapshot);
    analyzeIdentityDuplicates(context, snapshot);
    validateReferences(context, snapshot);
    validatePreservation(context, envelope, snapshot);
    addDerivedAndExcludedInfo(context, envelope, snapshot);
  }

  const targetRecords = options.targetAdapter && snapshot
    ? await readTargetRecords(context, snapshot, options.targetAdapter, Boolean(options.targetMustBeEmpty ?? true))
    : {};
  const plan = buildMigrationPlan(context, envelope, snapshot, targetRecords, targetSchemaVersion, Boolean(options.targetMustBeEmpty ?? true));
  applyPlanCountsToStorePreviews(context, plan);

  const totalSourceRecords = sumCounts(snapshot?.counts ?? {});
  const totalInvalidRecords = Object.values(context.storePreviews).reduce((total, preview) => total + (preview?.invalidCount ?? 0), 0);
  const totalManualReview = Object.values(context.storePreviews).reduce((total, preview) => total + (preview?.manualReviewCount ?? 0), 0);
  const issueCounts = countIssuesBySeverity(context.issues);
  const summary: MigrationPreviewSummary = {
    totalSourceRecords,
    totalValidRecords: Math.max(0, totalSourceRecords - totalInvalidRecords),
    totalInvalidRecords,
    totalBlockingIssues: issueCounts.blocking,
    totalWarnings: issueCounts.warning,
    totalInfo: issueCounts.info,
    totalManualReview,
    canProceed: plan.executable,
    rawBackupAvailable: Boolean(envelope.rawBackup),
    rollbackAvailable: Boolean(envelope.rawBackup),
    estimatedWorkload: estimateWorkload(totalSourceRecords),
    estimatedDurationLabel: estimateDuration(totalSourceRecords)
  };

  const issues = capIssues(sortIssues(context.issues), detailLimit);
  return {
    reportVersion: MIGRATION_REPORT_VERSION,
    migrationId,
    generatedAt,
    sourceStorage: "legacy-localStorage",
    targetStorage: "indexedDB",
    sourceSchemaVersion: snapshot?.sourceSchemaVersion ?? 0,
    targetSchemaVersion,
    backupId: envelope.backupId,
    rawChecksum: envelope.checksums?.raw,
    normalizedChecksum: envelope.checksums?.normalized ?? snapshot?.checksum,
    summary,
    stores: sortStorePreviews(context.storePreviews),
    issues,
    issueCountsByCode: context.issueCountsByCode,
    preservationChecks: sortPreservationChecks(context.preservationChecks),
    duplicateGroups: sortDuplicateGroups(context.duplicateGroups),
    brokenReferences: sortBrokenReferences(context.brokenReferences),
    plan
  };
}

export function createMigrationPreviewUserSummary(report: MigrationPreviewReport): MigrationPreviewUserSummary {
  const counts = {
    savedItems: report.stores.savedItems?.sourceCount ?? 0,
    importBatches: report.stores.importBatches?.sourceCount ?? 0,
    smartAlbums: report.stores.smartAlbums?.sourceCount ?? 0,
    actionCards: report.stores.actionCards?.sourceCount ?? 0,
    planCards: report.stores.planCards?.sourceCount ?? 0,
    corrections: report.stores.classificationCorrections?.sourceCount ?? 0
  };
  const blocking = report.summary.totalBlockingIssues;
  const manual = report.summary.totalManualReview;
  const canProceed = report.summary.canProceed;
  const headline = canProceed
    ? `已检查 ${report.summary.totalSourceRecords} 条本地数据，可以进入升级确认`
    : blocking > 0
      ? `已检查 ${report.summary.totalSourceRecords} 条本地数据，有 ${blocking} 个问题需要先处理`
      : `已检查 ${report.summary.totalSourceRecords} 条本地数据，有 ${manual} 条需要确认`;
  const description = canProceed
    ? "原始备份已经保留，本轮只是生成迁移预览，不会删除旧 localStorage，也不会修改任何收藏。"
    : "当前只完成预览检查，没有迁移、删除或修复任何数据。处理完需要确认的记录后再进入升级。";

  return {
    headline,
    description,
    counts,
    canProceed,
    blockingMessage: blocking > 0 ? "有阻断问题时不会执行迁移计划。" : undefined,
    warnings: createTopWarningMessages(report),
    preservedHighlights: [
      "用户备注、手动标题、分类纠正会逐条检查",
      "已确认和已归档的智能专辑状态会保留",
      "行动卡和计划卡只迁移已有内容，不会重新生成"
    ],
    excludedDataNotes: [
      "开发模式、QA 写入测试和真实试用记录默认不进入普通迁移",
      "搜索文本和文本修复属于可重建或独立操作，升级时不会自动修复"
    ],
    estimatedDurationLabel: report.summary.estimatedDurationLabel,
    nextStep: blocking > 0
      ? report.issues.some((issue) => issue.code === "NORMALIZED_SNAPSHOT_MISSING") ? "snapshot_invalid" : "backup_invalid"
      : manual > 0 || report.plan.requiresUserConfirmation ? "review_required" : "ready_to_migrate"
  };
}

export function createMigrationReport(report: MigrationPreviewReport): MigrationReport {
  return {
    reportVersion: MIGRATION_REPORT_VERSION,
    migrationId: report.migrationId,
    planVersion: report.plan.planVersion,
    sourceBackupId: report.backupId,
    sourceSchemaVersion: report.sourceSchemaVersion,
    targetSchemaVersion: report.targetSchemaVersion,
    previewGeneratedAt: report.generatedAt,
    status: report.summary.totalBlockingIssues > 0 ? "blocked" : report.summary.totalManualReview > 0 ? "review_required" : "preview_ready",
    sourceCounts: Object.fromEntries(Object.entries(report.stores).map(([store, preview]) => [store, preview?.sourceCount ?? 0])) as Partial<Record<StorageEntityName, number>>,
    plannedCounts: report.plan.expectedWriteCounts,
    blockingIssueCount: report.summary.totalBlockingIssues,
    warningCount: report.summary.totalWarnings,
    manualReviewCount: report.summary.totalManualReview,
    rawChecksum: report.rawChecksum,
    normalizedChecksum: report.normalizedChecksum,
    rollbackAvailable: report.summary.rollbackAvailable,
    executable: report.plan.executable
  };
}

async function appendSourceValidation(context: ValidationContext, envelope: LegacyBackupEnvelope, targetSchemaVersion: number): Promise<void> {
  const sourceValidation = await validateMigrationSource(envelope, {
    now: () => new Date(context.generatedAt),
    createMigrationId: () => context.migrationId,
    targetSchemaVersion,
    detailLimit: context.detailLimit
  });
  for (const issue of sourceValidation.issues) addExistingIssue(context, issue);
}

function validateSnapshotBasics(context: ValidationContext, snapshot: StorageSnapshot, targetSchemaVersion: number): void {
  if (snapshot.formatVersion !== SUPPORTED_SNAPSHOT_FORMAT_VERSION) {
    addIssue(context, {
      code: "UNSUPPORTED_SNAPSHOT_FORMAT",
      scope: "snapshot",
      message: "StorageSnapshot formatVersion is unsupported.",
      userMessage: "迁移快照版本暂不支持。"
    });
  }
  if (!Number.isInteger(snapshot.sourceSchemaVersion) || snapshot.sourceSchemaVersion < 1 || snapshot.sourceSchemaVersion > SUPPORTED_SOURCE_SCHEMA_MAX) {
    addIssue(context, {
      code: "UNSUPPORTED_SOURCE_SCHEMA",
      scope: "snapshot",
      message: "Source schemaVersion is unsupported.",
      userMessage: "旧数据版本暂不支持直接升级。"
    });
  }
  if (targetSchemaVersion !== DEFAULT_TARGET_SCHEMA_VERSION) {
    addIssue(context, {
      code: "UNSUPPORTED_TARGET_SCHEMA",
      scope: "target",
      message: "Target schemaVersion is unsupported.",
      userMessage: "目标存储版本暂不支持。"
    });
  }
  if (!isPlainRecord(snapshot.records)) {
    addIssue(context, {
      code: "STORE_RECORDS_INVALID",
      scope: "snapshot",
      message: "StorageSnapshot records must be an object.",
      userMessage: "迁移快照中的数据列表格式异常。"
    });
  }
}

function validateSnapshotStores(context: ValidationContext, snapshot: StorageSnapshot): void {
  for (const store of STORAGE_ENTITY_NAMES) {
    const records = snapshot.records?.[store] ?? [];
    const preview = getStorePreview(context, store);
    preview.sourceCount = records.length;
    preview.estimatedBytes = estimateRecordsBytes(records);
    const seenPrimaryKeys = new Set<StoragePrimaryKey>();

    if (SKIPPED_STORES.has(store) && records.length > 0) {
      addIssue(context, {
        code: store === "backups" ? "DERIVED_DATA_WILL_REBUILD" : "REQUIRES_MANUAL_REVIEW",
        scope: "store",
        store,
        message: `${store} is not migrated from legacy snapshots in Task 5.`,
        userMessage: store === "backups" ? "旧备份不会套娃迁移，会保留在原始备份里。" : "旧迁移状态不会直接带入新的迁移流程。",
        recoverable: true,
        requiresManualReview: store === "migrationMetadata"
      });
    }

    records.forEach((record, index) => {
      const validation = validateRecord(context, store, record, index);
      if (!validation.valid || validation.primaryKey === undefined) {
        preview.invalidCount += 1;
        preview.manualReviewCount += 1;
        return;
      }
      if (seenPrimaryKeys.has(validation.primaryKey)) {
        preview.duplicatePrimaryKeyCount += 1;
        preview.invalidCount += 1;
        preview.manualReviewCount += 1;
        addIssue(context, {
          code: "DUPLICATE_PRIMARY_KEY",
          scope: "duplicate",
          store,
          recordId: validation.primaryKey,
          message: `Duplicate primary key in ${store}.`,
          userMessage: "同一类数据里出现了重复编号，需要先确认保留哪一条。",
          requiresManualReview: true
        });
        addDuplicateGroup(context, store, "id", String(validation.primaryKey), [validation.primaryKey], "DUPLICATE_PRIMARY_KEY");
        return;
      }
      seenPrimaryKeys.add(validation.primaryKey);
      preview.validCount += 1;
    });

    const expectedCount = snapshot.counts?.[store] ?? 0;
    if (expectedCount !== records.length) {
      addIssue(context, {
        code: "COUNT_MISMATCH",
        scope: "store",
        store,
        message: `Snapshot count mismatch for ${store}.`,
        userMessage: "迁移快照里的数量和实际记录数不一致，需要重新生成备份。"
      });
    }
  }

  for (const storeName of Object.keys(snapshot.records ?? {})) {
    if (!STORAGE_ENTITY_NAMES.includes(storeName as StorageEntityName)) {
      addIssue(context, {
        code: "STORE_NOT_SUPPORTED",
        scope: "store",
        message: "StorageSnapshot contains an unsupported store.",
        userMessage: "迁移快照里有当前版本不认识的数据类型。"
      });
    }
  }
}

function validateRecord<K extends StorageEntityName>(
  context: ValidationContext,
  store: K,
  record: StorageRecordMap[K],
  index: number
): { valid: boolean; primaryKey?: StoragePrimaryKey } {
  if (!isPlainRecord(record)) {
    addIssue(context, {
      code: "INVALID_RECORD_SHAPE",
      scope: "record",
      store,
      message: `Record at index ${index} is not an object.`,
      userMessage: "有一条记录的结构异常，需要确认后再迁移。",
      requiresManualReview: true
    });
    return { valid: false };
  }
  let primaryKey: StoragePrimaryKey | undefined;
  try {
    primaryKey = getPrimaryKey(store, record);
  } catch {
    addIssue(context, {
      code: "MISSING_PRIMARY_KEY",
      scope: "record",
      store,
      message: `Record at index ${index} is missing a primary key.`,
      userMessage: "有一条记录缺少编号，无法安全迁移。",
      requiresManualReview: true
    });
    return { valid: false };
  }

  let valid = true;
  if (!isJsonSafeRecord(record)) {
    addIssue(context, {
      code: "INVALID_RECORD_SHAPE",
      scope: "record",
      store,
      recordId: primaryKey,
      message: `${store} record is not JSON-safe.`,
      userMessage: "有一条记录包含无法安全保存的结构，需要确认。",
      requiresManualReview: true
    });
    valid = false;
  }

  for (const issue of validateStoreSpecificRecord(store, record, primaryKey)) {
    addIssue(context, issue);
    if (MIGRATION_ISSUE_SEVERITY[issue.code] === "blocking") valid = false;
  }
  return { valid, primaryKey };
}

function validateStoreSpecificRecord<K extends StorageEntityName>(
  store: K,
  record: StorageRecordMap[K],
  recordId: StoragePrimaryKey
): Array<Omit<MigrationIssue, "id" | "severity">> {
  const issues: Array<Omit<MigrationIssue, "id" | "severity">> = [];
  const source = record as unknown as Record<string, unknown>;
  const requireString = (field: string, code: MigrationIssueCode = "INVALID_RECORD_SHAPE"): void => {
    if (typeof source[field] !== "string") {
      issues.push(makeRecordIssue(code, store, recordId, field, `${store}.${field} must be a string.`, "有一条记录缺少必要文本字段。"));
    }
  };
  const requireArray = (field: string): void => {
    if (!Array.isArray(source[field])) {
      issues.push(makeRecordIssue("INVALID_RECORD_SHAPE", store, recordId, field, `${store}.${field} must be an array.`, "有一条记录的列表字段格式异常。"));
    }
  };
  const optionalDate = (field: string): void => {
    if (source[field] !== undefined && !isIsoLikeDate(source[field])) {
      issues.push(makeRecordIssue("INVALID_DATE", store, recordId, field, `${store}.${field} is not a valid date.`, "有一条记录的时间格式需要确认。", true));
    }
  };
  const requireDate = (field: string): void => {
    if (!isIsoLikeDate(source[field])) {
      issues.push(makeRecordIssue("INVALID_DATE", store, recordId, field, `${store}.${field} is not a valid date.`, "有一条记录的时间格式需要确认。", true));
    }
  };
  const requireStatus = (field: string, allowed: Set<string>): void => {
    if (typeof source[field] !== "string" || !allowed.has(String(source[field]))) {
      issues.push(makeRecordIssue("INVALID_STATUS", store, recordId, field, `${store}.${field} is not a supported status.`, "有一条记录的状态值需要确认。", true));
    }
  };
  const requireNonNegativeNumber = (field: string): void => {
    const value = source[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      issues.push(makeRecordIssue("INVALID_RECORD_SHAPE", store, recordId, field, `${store}.${field} must be a non-negative number.`, "有一条记录的统计数字格式异常。", true));
    }
  };

  switch (store) {
    case "savedItems":
      requireString("sourceUrl");
      requireString("userNote");
      requireString("contentDomain");
      requireString("contentSubDomain");
      requireString("savedIntent");
      requireStatus("status", ITEM_STATUSES);
      requireDate("createdAt");
      requireDate("updatedAt");
      requireArray("keywords");
      requireArray("entities");
      break;
    case "importBatches":
      requireString("source");
      requireStatus("status", IMPORT_BATCH_STATUSES);
      requireDate("createdAt");
      optionalDate("updatedAt");
      ["rawCount", "importedCount", "duplicateCount", "failedCount", "createdActionCardCount", "createdAlbumCount"].forEach(requireNonNegativeNumber);
      if (Array.isArray(source.items)) {
        issues.push(makeRecordIssue("DERIVED_DATA_WILL_REBUILD", store, recordId, "items", "Nested import batch items are reported but not duplicated.", "批次里的旧嵌套明细会按独立明细检查，不会重复迁移。", false));
      }
      break;
    case "importBatchItems":
      requireString("batchId");
      requireString("sourceUrl");
      requireStatus("status", IMPORT_BATCH_ITEM_STATUSES);
      requireDate("createdAt");
      break;
    case "smartAlbums":
      requireString("title");
      requireString("albumType");
      requireStatus("status", ALBUM_STATUSES);
      requireArray("savedItemIds");
      requireArray("recommendedItemIds");
      optionalArrayIssue(source, issues, store, recordId, "suggestedItemIds");
      optionalArrayIssue(source, issues, store, recordId, "manuallyAddedItemIds");
      optionalArrayIssue(source, issues, store, recordId, "manuallyRemovedItemIds");
      optionalDate("confirmedAt");
      optionalDate("archivedAt");
      break;
    case "actionCards":
      requireString("savedItemId");
      requireString("nextAction");
      requireString("doneCriteria");
      requireDate("createdAt");
      optionalDate("updatedAt");
      break;
    case "planCards":
      requireString("savedItemId");
      requireString("actionCardId");
      requireString("plannedDate");
      requireNonNegativeNumber("estimatedMinutes");
      requireString("oneNextStep");
      requireString("doneCriteria");
      requireStatus("status", PLAN_CARD_STATUSES);
      optionalDate("completedAt");
      optionalDate("cancelledAt");
      break;
    case "classificationCorrections":
      requireString("savedItemId");
      requireString("textSnapshot");
      requireDate("createdAt");
      break;
    case "searchLogs":
      requireString("query");
      requireNonNegativeNumber("resultCount");
      requireDate("createdAt");
      break;
    case "settings":
      requireString("key");
      if (!SETTING_CATEGORIES.has(String(source.category))) {
        issues.push(makeRecordIssue("INVALID_STATUS", store, recordId, "category", "Setting category is unsupported.", "有一条设置分类需要确认。", true));
      }
      if (typeof source.internal !== "boolean") {
        issues.push(makeRecordIssue("INVALID_RECORD_SHAPE", store, recordId, "internal", "Setting internal flag must be boolean.", "有一条设置的内部标记格式异常。", true));
      }
      requireDate("updatedAt");
      break;
    case "migrationMetadata":
      issues.push(makeRecordIssue("REQUIRES_MANUAL_REVIEW", store, recordId, "status", "Legacy migration metadata is not carried into a new migration.", "旧迁移状态不会直接带入新流程，需要确认。", true));
      break;
    case "backups":
      issues.push(makeRecordIssue("DERIVED_DATA_WILL_REBUILD", store, recordId, "snapshot", "Nested backups are not migrated as records.", "旧备份不会套娃迁移，会保留在原始备份里。", false));
      break;
  }
  return issues;
}

function makeRecordIssue(
  code: MigrationIssueCode,
  store: StorageEntityName,
  recordId: StoragePrimaryKey,
  field: string,
  message: string,
  userMessage: string,
  requiresManualReview = true
): Omit<MigrationIssue, "id" | "severity"> {
  return {
    code,
    scope: "record",
    store,
    recordId,
    field,
    message,
    userMessage,
    recoverable: true,
    requiresManualReview
  };
}

function optionalArrayIssue(
  source: Record<string, unknown>,
  issues: Array<Omit<MigrationIssue, "id" | "severity">>,
  store: StorageEntityName,
  recordId: StoragePrimaryKey,
  field: string
): void {
  if (source[field] !== undefined && !Array.isArray(source[field])) {
    issues.push(makeRecordIssue("INVALID_RECORD_SHAPE", store, recordId, field, `${store}.${field} must be an array when present.`, "有一条专辑成员列表格式异常。"));
  }
}

function analyzeIdentityDuplicates(context: ValidationContext, snapshot: StorageSnapshot): void {
  const savedItems = snapshot.records.savedItems ?? [];
  analyzeDuplicateField(context, "savedItems", savedItems, "sourceItemId", "SOURCE_ITEM_ID_DUPLICATE");
  analyzeDuplicateField(context, "savedItems", savedItems, "normalizedSourceUrl", "NORMALIZED_URL_DUPLICATE", (item) =>
    normalizeSourceUrl((item as SavedItem & { normalizedSourceUrl?: string }).normalizedSourceUrl || (item as SavedItem).sourceUrl)
  );
}

function analyzeDuplicateField<K extends StorageEntityName>(
  context: ValidationContext,
  store: K,
  records: StorageRecordMap[K][],
  field: "sourceItemId" | "normalizedSourceUrl",
  code: MigrationIssueCode,
  getValue?: (record: StorageRecordMap[K]) => string | undefined
): void {
  const groups = new Map<string, StoragePrimaryKey[]>();
  for (const record of records) {
    const value = getValue ? getValue(record) : stringValue((record as unknown as Record<string, unknown>)[field]);
    if (!value) continue;
    const id = getPrimaryKey(store, record);
    const existing = groups.get(value) ?? [];
    existing.push(id);
    groups.set(value, existing);
  }
  for (const [value, ids] of groups) {
    if (ids.length < 2) continue;
    const preview = getStorePreview(context, store);
    preview.identityDuplicateCount += ids.length;
    addDuplicateGroup(context, store, field, value, ids, code);
    for (const id of ids) {
      addIssue(context, {
        code,
        scope: "duplicate",
        store,
        recordId: id,
        field,
        message: `Duplicate ${field} detected in ${store}.`,
        userMessage: field === "sourceItemId" ? "有多条收藏来自同一个来源编号，需要确认是否重复。" : "有多条收藏使用同一个链接，需要确认是否重复。",
        requiresManualReview: true
      });
    }
  }
}

function validateReferences(context: ValidationContext, snapshot: StorageSnapshot): void {
  const savedItemIds = new Set((snapshot.records.savedItems ?? []).map((item) => item.id));
  const actionCardIds = new Set((snapshot.records.actionCards ?? []).map((card) => card.id));
  const batchIds = new Set((snapshot.records.importBatches ?? []).map((batch) => batch.id));

  for (const item of snapshot.records.importBatchItems ?? []) {
    addReferenceIfMissing(context, "importBatchItems", item.id, "batchId", "importBatches", item.batchId, batchIds, true);
    if (item.status === "imported" && item.createdSavedItemId) {
      addReferenceIfMissing(context, "importBatchItems", item.id, "createdSavedItemId", "savedItems", item.createdSavedItemId, savedItemIds, true);
    }
  }
  for (const album of snapshot.records.smartAlbums ?? []) {
    for (const id of album.savedItemIds) addReferenceIfMissing(context, "smartAlbums", album.id, "savedItemIds", "savedItems", id, savedItemIds, true);
    for (const id of album.recommendedItemIds) addReferenceIfMissing(context, "smartAlbums", album.id, "recommendedItemIds", "savedItems", id, savedItemIds, false);
    for (const id of album.suggestedItemIds ?? []) addReferenceIfMissing(context, "smartAlbums", album.id, "suggestedItemIds", "savedItems", id, savedItemIds, false);
    for (const id of album.manuallyAddedItemIds ?? []) addReferenceIfMissing(context, "smartAlbums", album.id, "manuallyAddedItemIds", "savedItems", id, savedItemIds, false);
    for (const id of album.manuallyRemovedItemIds ?? []) addReferenceIfMissing(context, "smartAlbums", album.id, "manuallyRemovedItemIds", "savedItems", id, savedItemIds, false);
  }
  for (const card of snapshot.records.actionCards ?? []) {
    addReferenceIfMissing(context, "actionCards", card.id, "savedItemId", "savedItems", card.savedItemId, savedItemIds, true);
  }
  for (const plan of snapshot.records.planCards ?? []) {
    addReferenceIfMissing(context, "planCards", plan.id, "savedItemId", "savedItems", plan.savedItemId, savedItemIds, true);
    addReferenceIfMissing(context, "planCards", plan.id, "actionCardId", "actionCards", plan.actionCardId, actionCardIds, true);
  }
  for (const correction of snapshot.records.classificationCorrections ?? []) {
    addReferenceIfMissing(context, "classificationCorrections", correction.id, "savedItemId", "savedItems", correction.savedItemId, savedItemIds, true);
  }
}

function addReferenceIfMissing(
  context: ValidationContext,
  store: StorageEntityName,
  recordId: StoragePrimaryKey,
  field: string,
  relatedStore: StorageEntityName,
  relatedRecordId: StoragePrimaryKey | undefined,
  validIds: Set<StoragePrimaryKey>,
  required: boolean
): void {
  if ((typeof relatedRecordId !== "string" && typeof relatedRecordId !== "number") || relatedRecordId === "" || validIds.has(relatedRecordId)) return;
  const code = required ? "BROKEN_REQUIRED_REFERENCE" : "BROKEN_OPTIONAL_REFERENCE";
  const issue = addIssue(context, {
    code,
    scope: "reference",
    store,
    recordId,
    field,
    relatedStore,
    relatedRecordId,
    message: `${store}.${field} references a missing ${relatedStore} record.`,
    userMessage: required ? "有一条数据引用的来源记录不存在，需要先确认。" : "有一条推荐或候选引用不存在，迁移时需要确认。",
    requiresManualReview: true
  });
  getStorePreview(context, store).brokenReferenceCount += 1;
  context.brokenReferences.push({
    id: issue.id,
    store,
    recordId,
    field,
    relatedStore,
    relatedRecordId,
    required,
    issueId: issue.id
  });
}

function validatePreservation(context: ValidationContext, envelope: LegacyBackupEnvelope, snapshot: StorageSnapshot): void {
  const raw = envelope.rawBackup?.rawRecords?.[LEGACY_APP_STATE_STORAGE_KEY];
  if (!raw) {
    addPreservationCheck(context, "rawBackup", "rawBackup", "appState", "cannot_verify");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    addPreservationCheck(context, "rawBackup", "rawBackup", "appState", "cannot_verify");
    return;
  }
  if (!isPlainRecord(parsed)) return;

  compareById(context, "savedItems", parsed.savedItems, snapshot.records.savedItems ?? [], ["userNote", "userEditedTitle", "sourceUrl", "contentDomain", "contentSubDomain", "savedIntent"], {
    userNote: "USER_NOTE_NOT_PRESERVED",
    userEditedTitle: "USER_EDITED_TITLE_NOT_PRESERVED",
    sourceUrl: "SOURCE_URL_NOT_PRESERVED",
    contentDomain: "MANUAL_CLASSIFICATION_NOT_PRESERVED",
    contentSubDomain: "MANUAL_CLASSIFICATION_NOT_PRESERVED",
    savedIntent: "MANUAL_CLASSIFICATION_NOT_PRESERVED"
  });
  compareById(context, "smartAlbums", parsed.smartAlbums, snapshot.records.smartAlbums ?? [], ["savedItemIds", "manuallyAddedItemIds", "manuallyRemovedItemIds", "status", "confirmedAt", "archivedAt"], {
    savedItemIds: "MANUAL_ALBUM_MEMBERSHIP_NOT_PRESERVED",
    manuallyAddedItemIds: "MANUAL_ALBUM_MEMBERSHIP_NOT_PRESERVED",
    manuallyRemovedItemIds: "MANUAL_ALBUM_MEMBERSHIP_NOT_PRESERVED",
    status: "ALBUM_STATUS_NOT_PRESERVED",
    confirmedAt: "ALBUM_STATUS_NOT_PRESERVED",
    archivedAt: "ALBUM_STATUS_NOT_PRESERVED"
  });
  compareById(context, "actionCards", parsed.actionCards, snapshot.records.actionCards ?? [], ["title", "nextAction", "doneCriteria", "output"], {
    title: "ACTION_CARD_CONTENT_NOT_PRESERVED",
    nextAction: "ACTION_CARD_CONTENT_NOT_PRESERVED",
    doneCriteria: "ACTION_CARD_CONTENT_NOT_PRESERVED",
    output: "ACTION_CARD_CONTENT_NOT_PRESERVED"
  });
  compareById(context, "planCards", parsed.planCards, snapshot.records.planCards ?? [], ["status", "plannedDate", "completedAt", "cancelledAt"], {
    status: "PLAN_CARD_STATE_NOT_PRESERVED",
    plannedDate: "PLAN_CARD_STATE_NOT_PRESERVED",
    completedAt: "PLAN_CARD_STATE_NOT_PRESERVED",
    cancelledAt: "PLAN_CARD_STATE_NOT_PRESERVED"
  });
  compareById(context, "classificationCorrections", parsed.classificationCorrections, snapshot.records.classificationCorrections ?? [], ["previousDomain", "previousSubDomain", "previousIntent", "correctedDomain", "correctedSubDomain", "correctedIntent", "textSnapshot"], {
    previousDomain: "CLASSIFICATION_CORRECTION_NOT_PRESERVED",
    previousSubDomain: "CLASSIFICATION_CORRECTION_NOT_PRESERVED",
    previousIntent: "CLASSIFICATION_CORRECTION_NOT_PRESERVED",
    correctedDomain: "CLASSIFICATION_CORRECTION_NOT_PRESERVED",
    correctedSubDomain: "CLASSIFICATION_CORRECTION_NOT_PRESERVED",
    correctedIntent: "CLASSIFICATION_CORRECTION_NOT_PRESERVED",
    textSnapshot: "CLASSIFICATION_CORRECTION_NOT_PRESERVED"
  });

  const settingKeys = new Set((snapshot.records.settings ?? []).map((setting) => setting.key));
  addPreservationCheck(context, "settings", "setting-theme", "theme", settingKeys.has("theme") ? "passed" : "failed", "THEME_NOT_PRESERVED");
  addPreservationCheck(context, "settings", "setting-achievements", "achievements", settingKeys.has("achievements") ? "passed" : "failed", "ACHIEVEMENT_NOT_PRESERVED");
}

function compareById<K extends StorageEntityName>(
  context: ValidationContext,
  store: K,
  rawValue: unknown,
  normalized: StorageRecordMap[K][],
  fields: string[],
  codes: Record<string, MigrationIssueCode>
): void {
  if (!Array.isArray(rawValue)) {
    if (normalized.length > 0) addPreservationCheck(context, store, "collection", "records", "cannot_verify");
    return;
  }
  const normalizedById = new Map<string, Record<string, unknown>>();
  for (const record of normalized) {
    try {
      normalizedById.set(String(getPrimaryKey(store, record)), record as unknown as Record<string, unknown>);
    } catch {
      // Invalid normalized records are reported by validateRecord; preservation checks
      // should keep producing a preview instead of throwing.
    }
  }
  for (const rawRecord of rawValue) {
    if (!isPlainRecord(rawRecord) || (typeof rawRecord.id !== "string" && typeof rawRecord.id !== "number")) continue;
    const recordId = rawRecord.id;
    const target = normalizedById.get(String(recordId));
    if (!target) {
      addPreservationCheck(context, store, recordId, "record", "failed", Object.values(codes)[0]);
      continue;
    }
    for (const field of fields) {
      if (!(field in rawRecord)) continue;
      const status = canonicalCompare(rawRecord[field], target[field]) ? "passed" : "failed";
      addPreservationCheck(context, store, recordId, field, status, codes[field]);
    }
  }
}

function addPreservationCheck(
  context: ValidationContext,
  store: StorageEntityName | "rawBackup",
  recordId: StoragePrimaryKey,
  field: string,
  status: DataPreservationCheck["status"],
  code?: MigrationIssueCode
): void {
  let issueId: string | undefined;
  if (status === "failed" && code && store !== "rawBackup") {
    const issue = addIssue(context, {
      code,
      scope: "preservation",
      store,
      recordId,
      field,
      message: `${store}.${field} was not preserved exactly.`,
      userMessage: "有一项用户手动整理过的数据没有被完整保留，需要先处理。",
      requiresManualReview: true
    });
    issueId = issue.id;
  }
  context.preservationChecks.push({
    id: `preserve:${String(store)}:${String(recordId)}:${field}`,
    store,
    recordId,
    field,
    status,
    ...(issueId ? { issueId } : {})
  });
}

function addDerivedAndExcludedInfo(context: ValidationContext, envelope: LegacyBackupEnvelope, snapshot: StorageSnapshot): void {
  if ((snapshot.records.savedItems ?? []).length > 0) {
    addIssue(context, {
      code: "DERIVED_DATA_WILL_REBUILD",
      scope: "migration",
      message: "Searchable text and runtime search indexes are derived data.",
      userMessage: "搜索索引属于可重建数据，升级时会按当前规则重新建立。",
      recoverable: true
    });
  }
  for (const issue of envelope.report?.issues ?? []) {
    if (issue.code === "INTERNAL_KEY_EXCLUDED" || issue.code === "SENSITIVE_KEY_EXCLUDED") {
      addIssue(context, {
        code: "INTERNAL_DATA_EXCLUDED",
        scope: "rawBackup",
        message: "Internal or test localStorage data was excluded from the default migration.",
        userMessage: "开发、测试或敏感数据默认不会进入普通迁移。",
        recoverable: true
      });
    }
  }
  for (const item of snapshot.records.savedItems ?? []) {
    if ((item.textNormalizationVersion ?? 0) < 3) {
      addIssue(context, {
        code: "TEXT_REPAIR_PENDING",
        scope: "record",
        store: "savedItems",
        recordId: item.id,
        field: "textNormalizationVersion",
        message: "SavedItem may still need separate scanned text repair.",
        userMessage: "有收藏可能还需要单独执行文本修复；这和存储升级分开处理。",
        requiresManualReview: false
      });
    }
  }
}

async function readTargetRecords(
  context: ValidationContext,
  snapshot: StorageSnapshot,
  targetAdapter: Pick<StorageAdapter, "getAll">,
  targetMustBeEmpty: boolean
): Promise<Partial<Record<StorageEntityName, StorageRecordMap[StorageEntityName][]>>> {
  const output: Partial<Record<StorageEntityName, StorageRecordMap[StorageEntityName][]>> = {};
  for (const store of STORAGE_ENTITY_NAMES) {
    if (!snapshot.records[store]) continue;
    try {
      const records = await targetAdapter.getAll(store as never) as StorageRecordMap[StorageEntityName][];
      output[store] = records;
      if (targetMustBeEmpty && records.length > 0) {
        addIssue(context, {
          code: "TARGET_NOT_EMPTY",
          scope: "target",
          store,
          message: `Target ${store} is not empty.`,
          userMessage: "目标存储里已经有数据，本轮只做只读比较，不会覆盖。",
          recoverable: true
        });
      }
    } catch {
      addIssue(context, {
        code: "REQUIRES_MANUAL_REVIEW",
        scope: "target",
        store,
        message: `Could not read target ${store} for preview comparison.`,
        userMessage: "目标存储读取失败，本轮不会写入，需要确认后再迁移。",
        requiresManualReview: true
      });
    }
  }
  return output;
}

function buildMigrationPlan(
  context: ValidationContext,
  envelope: LegacyBackupEnvelope,
  snapshot: StorageSnapshot | undefined,
  targetRecords: Partial<Record<StorageEntityName, StorageRecordMap[StorageEntityName][]>>,
  targetSchemaVersion: number,
  targetMustBeEmpty: boolean
): MigrationPlan {
  const storePlans: Partial<Record<StorageEntityName, MigrationStorePlan>> = {};
  const expectedWriteCounts: Partial<Record<StorageEntityName, number>> = {};
  const expectedSourceCounts = snapshot?.counts ?? {};

  for (const store of STORAGE_ENTITY_NAMES) {
    const records = snapshot?.records[store] ?? [];
    if (records.length === 0) continue;
    const targetById = new Map((targetRecords[store] ?? []).map((record) => [String(getPrimaryKey(store, record as never)), record]));
    const operations: MigrationRecordOperation[] = [];
    for (const record of records) {
      let recordId: StoragePrimaryKey;
      try {
        recordId = getPrimaryKey(store, record as never);
      } catch {
        continue;
      }
      const sourceChecksum = recordChecksum(record);
      const recordKey = makeRecordKey(store, recordId);
      const hasBlocking = [...(context.recordIssueIds.get(recordKey) ?? [])]
        .map((id) => context.issues.find((issue) => issue.id === id))
        .some((issue) => issue?.severity === "blocking");
      const hasManualReview = (context.recordManualReviewIds.get(recordKey)?.size ?? 0) > 0;
      const target = targetById.get(String(recordId));
      if (hasBlocking || hasManualReview || SKIPPED_STORES.has(store)) {
        operations.push({ store, recordId, operation: "manual_review", reasonCode: hasBlocking ? "MIGRATION_BLOCKED" : "REQUIRES_MANUAL_REVIEW", sourceChecksum });
        continue;
      }
      if (!target) {
        operations.push({ store, recordId, operation: "create", reasonCode: "VALID_NEW_RECORD", sourceChecksum });
        continue;
      }
      const targetChecksum = recordChecksum(target);
      if (sourceChecksum === targetChecksum) {
        addIssue(context, {
          code: "TARGET_RECORD_IDENTICAL",
          scope: "target",
          store,
          recordId,
          message: `Target ${store} record is identical.`,
          userMessage: "目标存储中已有一条完全相同的数据，本轮会计划跳过。",
          recoverable: true
        });
        operations.push({ store, recordId, operation: "skip", reasonCode: "TARGET_RECORD_IDENTICAL", sourceChecksum, targetChecksum });
      } else {
        const issue = addIssue(context, {
          code: "TARGET_RECORD_CONFLICT",
          scope: "target",
          store,
          recordId,
          message: `Target ${store} record differs from source.`,
          userMessage: "目标存储中已有同编号但内容不同的数据，需要人工确认。",
          requiresManualReview: true
        });
        context.recordManualReviewIds.set(recordKey, new Set([...(context.recordManualReviewIds.get(recordKey) ?? []), issue.id]));
        operations.push({ store, recordId, operation: "conflict", reasonCode: "TARGET_RECORD_CONFLICT", sourceChecksum, targetChecksum });
      }
    }
    const plan = createStorePlan(store, operations);
    storePlans[store] = plan;
    expectedWriteCounts[store] = plan.createCount + plan.updateCount;
  }

  const allPlans = Object.values(storePlans).filter(Boolean) as MigrationStorePlan[];
  const manualReviewCount = allPlans.reduce((total, plan) => total + plan.manualReviewCount, 0);
  const conflictCount = allPlans.reduce((total, plan) => total + plan.conflictCount, 0);
  const blockingIssueIds = context.issues.filter((issue) => issue.severity === "blocking").map((issue) => issue.id);
  const warningIssueIds = context.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.id);
  const executable = blockingIssueIds.length === 0 && manualReviewCount === 0 && conflictCount === 0;

  return {
    planVersion: MIGRATION_PLAN_VERSION,
    migrationId: context.migrationId,
    sourceBackupId: envelope.backupId,
    sourceSnapshotChecksum: envelope.checksums?.normalized ?? snapshot?.checksum,
    sourceSchemaVersion: snapshot?.sourceSchemaVersion ?? 0,
    targetSchemaVersion,
    generatedAt: context.generatedAt,
    executable,
    requiredStores: STORAGE_ENTITY_NAMES.filter((store) => Boolean(snapshot?.records[store]?.length)),
    storePlans,
    blockingIssueIds,
    warningIssueIds,
    requiresUserConfirmation: warningIssueIds.length > 0 || manualReviewCount > 0 || conflictCount > 0,
    expectedSourceCounts,
    expectedWriteCounts,
    targetMustBeEmpty
  };
}

function createStorePlan(store: StorageEntityName, operations: MigrationRecordOperation[]): MigrationStorePlan {
  const sorted = operations.sort((a, b) => String(a.recordId).localeCompare(String(b.recordId), "en", { numeric: true }));
  return {
    store,
    operations: sorted,
    createCount: sorted.filter((operation) => operation.operation === "create").length,
    updateCount: sorted.filter((operation) => operation.operation === "update").length,
    skipCount: sorted.filter((operation) => operation.operation === "skip").length,
    conflictCount: sorted.filter((operation) => operation.operation === "conflict").length,
    manualReviewCount: sorted.filter((operation) => operation.operation === "manual_review").length
  };
}

function applyPlanCountsToStorePreviews(context: ValidationContext, plan: MigrationPlan): void {
  for (const store of STORAGE_ENTITY_NAMES) {
    const storePlan = plan.storePlans[store];
    if (!storePlan) continue;
    const preview = getStorePreview(context, store);
    preview.plannedCreateCount = storePlan.createCount;
    preview.plannedUpdateCount = storePlan.updateCount;
    preview.plannedSkipCount = storePlan.skipCount;
    preview.plannedConflictCount = storePlan.conflictCount;
    preview.manualReviewCount = Math.max(preview.manualReviewCount, storePlan.manualReviewCount);
  }
}

function createStorePreview(store: StorageEntityName): MigrationStorePreview {
  return {
    store,
    sourceCount: 0,
    validCount: 0,
    invalidCount: 0,
    duplicatePrimaryKeyCount: 0,
    identityDuplicateCount: 0,
    brokenReferenceCount: 0,
    manualReviewCount: 0,
    plannedCreateCount: 0,
    plannedUpdateCount: 0,
    plannedSkipCount: 0,
    plannedConflictCount: 0,
    estimatedBytes: 0
  };
}

function getStorePreview(context: ValidationContext, store: StorageEntityName): MigrationStorePreview {
  const preview = context.storePreviews[store] ?? createStorePreview(store);
  context.storePreviews[store] = preview;
  return preview;
}

function addIssue(
  context: ValidationContext,
  input: Omit<MigrationIssue, "id" | "severity" | "recoverable" | "requiresManualReview"> & Partial<Pick<MigrationIssue, "recoverable" | "requiresManualReview">>
): MigrationIssue {
  const severity = MIGRATION_ISSUE_SEVERITY[input.code];
  const issue: MigrationIssue = {
    id: `issue_${String(context.issueSequence += 1).padStart(5, "0")}`,
    severity,
    recoverable: input.recoverable ?? true,
    requiresManualReview: input.requiresManualReview ?? severity !== "info",
    ...input,
    message: sanitizeMigrationMessage(input.message),
    userMessage: sanitizeMigrationMessage(input.userMessage)
  };
  context.issues.push(issue);
  context.issueCountsByCode[issue.code] = (context.issueCountsByCode[issue.code] ?? 0) + 1;
  if (issue.store && issue.recordId !== undefined) {
    const recordKey = makeRecordKey(issue.store, issue.recordId);
    context.recordIssueIds.set(recordKey, new Set([...(context.recordIssueIds.get(recordKey) ?? []), issue.id]));
    if (issue.requiresManualReview) {
      context.recordManualReviewIds.set(recordKey, new Set([...(context.recordManualReviewIds.get(recordKey) ?? []), issue.id]));
    }
  }
  return issue;
}

function addExistingIssue(context: ValidationContext, issue: MigrationIssue): void {
  const existing = context.issues.some((candidate) =>
    candidate.code === issue.code &&
    candidate.scope === issue.scope &&
    candidate.store === issue.store &&
    candidate.recordId === issue.recordId &&
    candidate.field === issue.field
  );
  if (existing) return;
  addIssue(context, {
    code: issue.code,
    scope: issue.scope,
    store: issue.store,
    recordId: issue.recordId,
    field: issue.field,
    relatedStore: issue.relatedStore,
    relatedRecordId: issue.relatedRecordId,
    message: issue.message,
    userMessage: issue.userMessage,
    recoverable: issue.recoverable,
    requiresManualReview: issue.requiresManualReview
  });
}

function mapLegacyIssue(context: ValidationContext, legacyIssue: LegacySnapshotIssue): void {
  if (legacyIssue.code === "INTERNAL_KEY_EXCLUDED" || legacyIssue.code === "SENSITIVE_KEY_EXCLUDED" || legacyIssue.code === "UNKNOWN_STORAGE_KEY") {
    addIssue(context, {
      code: "INTERNAL_DATA_EXCLUDED",
      scope: "rawBackup",
      message: "Legacy reader excluded a non-product key.",
      userMessage: "有开发、测试或未知数据没有进入普通迁移，这是预期行为。",
      recoverable: true,
      requiresManualReview: false
    });
  } else if (legacyIssue.severity === "error") {
    addIssue(context, {
      code: legacyIssue.code === "KEY_MISSING" ? "RAW_BACKUP_MISSING" : "BACKUP_ENVELOPE_INVALID",
      scope: "rawBackup",
      store: legacyIssue.store,
      recordId: legacyIssue.recordId,
      message: "Legacy backup reader reported an error.",
      userMessage: "旧数据备份阶段报告了错误，需要重新生成备份。",
      requiresManualReview: true
    });
  }
}

function createValidationContext(migrationId: string, generatedAt: string, detailLimit = DEFAULT_DETAIL_LIMIT): ValidationContext {
  return {
    migrationId,
    generatedAt,
    detailLimit,
    issues: [],
    issueCountsByCode: {},
    storePreviews: {},
    duplicateGroups: [],
    brokenReferences: [],
    preservationChecks: [],
    recordIssueIds: new Map(),
    recordManualReviewIds: new Map(),
    issueSequence: 0
  };
}

function addDuplicateGroup(
  context: ValidationContext,
  store: StorageEntityName,
  field: MigrationDuplicateGroup["field"],
  value: string,
  recordIds: StoragePrimaryKey[],
  issueCode: MigrationIssueCode
): void {
  context.duplicateGroups.push({
    id: `duplicate:${store}:${field}:${fingerprint(value)}`,
    store,
    field,
    valueFingerprint: fingerprint(value),
    recordIds: [...recordIds].sort(comparePrimaryKeys),
    issueCode
  });
}

function sortIssues(issues: MigrationIssue[]): MigrationIssue[] {
  const severityRank: Record<MigrationIssueSeverity, number> = { blocking: 0, warning: 1, info: 2 };
  return [...issues].sort((a, b) =>
    severityRank[a.severity] - severityRank[b.severity] ||
    String(a.store ?? "").localeCompare(String(b.store ?? "")) ||
    String(a.recordId ?? "").localeCompare(String(b.recordId ?? ""), "en", { numeric: true }) ||
    a.code.localeCompare(b.code) ||
    a.id.localeCompare(b.id)
  );
}

function capIssues(issues: MigrationIssue[], detailLimit: number): MigrationIssue[] {
  const seen = new Map<MigrationIssueCode, number>();
  return issues.filter((issue) => {
    const count = seen.get(issue.code) ?? 0;
    seen.set(issue.code, count + 1);
    return count < detailLimit;
  });
}

function countIssuesBySeverity(issues: MigrationIssue[]): Record<MigrationIssueSeverity, number> {
  return issues.reduce<Record<MigrationIssueSeverity, number>>((counts, issue) => {
    counts[issue.severity] += 1;
    return counts;
  }, { blocking: 0, warning: 0, info: 0 });
}

function sortStorePreviews(stores: Partial<Record<StorageEntityName, MigrationStorePreview>>): Partial<Record<StorageEntityName, MigrationStorePreview>> {
  const output: Partial<Record<StorageEntityName, MigrationStorePreview>> = {};
  for (const store of STORAGE_ENTITY_NAMES) {
    if (stores[store]) output[store] = stores[store];
  }
  return output;
}

function sortDuplicateGroups(groups: MigrationDuplicateGroup[]): MigrationDuplicateGroup[] {
  return [...groups].sort((a, b) =>
    a.store.localeCompare(b.store) ||
    a.field.localeCompare(b.field) ||
    a.valueFingerprint.localeCompare(b.valueFingerprint)
  );
}

function sortBrokenReferences(references: MigrationBrokenReference[]): MigrationBrokenReference[] {
  return [...references].sort((a, b) =>
    a.store.localeCompare(b.store) ||
    String(a.recordId).localeCompare(String(b.recordId), "en", { numeric: true }) ||
    a.field.localeCompare(b.field)
  );
}

function sortPreservationChecks(checks: DataPreservationCheck[]): DataPreservationCheck[] {
  return [...checks].sort((a, b) =>
    String(a.store).localeCompare(String(b.store)) ||
    String(a.recordId ?? "").localeCompare(String(b.recordId ?? ""), "en", { numeric: true }) ||
    a.field.localeCompare(b.field)
  );
}

function getPrimaryKey<K extends StorageEntityName>(store: K, record: StorageRecordMap[K] | unknown): StoragePrimaryKey {
  if (!isPlainRecord(record)) {
    throw new StorageError({ adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", message: "Record is not an object.", recoverable: true, store });
  }
  const key = record[STORE_PRIMARY_KEYS[store]];
  if ((typeof key !== "string" && typeof key !== "number") || key === "") {
    throw new StorageError({ adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", message: "Record is missing a primary key.", recoverable: true, store });
  }
  return key;
}

function isJsonSafeRecord(value: unknown): boolean {
  try {
    cloneJsonSafe(value, { adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", recoverable: true });
    return true;
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isIsoLikeDate(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function normalizeSourceUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function canonicalCompare(a: unknown, b: unknown): boolean {
  return canonicalJsonStringify(a, { adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", recoverable: true }) ===
    canonicalJsonStringify(b, { adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", recoverable: true });
}

function recordChecksum(record: unknown): string {
  return fingerprint(canonicalJsonStringify(record, { adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", recoverable: true }));
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function estimateRecordsBytes(records: unknown[]): number {
  if (records.length === 0) return 0;
  const text = canonicalJsonStringify(records, { adapter: "localStorage", code: "STORAGE_VALIDATION_FAILED", recoverable: true });
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(text).length : text.length;
}

function estimateWorkload(totalRecords: number): MigrationPreviewSummary["estimatedWorkload"] {
  if (totalRecords <= 500) return "small";
  if (totalRecords <= 3000) return "medium";
  if (totalRecords <= 10000) return "large";
  return "very_large";
}

function estimateDuration(totalRecords: number): string {
  const workload = estimateWorkload(totalRecords);
  if (workload === "small") return "少量数据：通常不到 1 分钟";
  if (workload === "medium") return "中等数据：通常约 1—3 分钟";
  if (workload === "large") return "较多数据：通常约 3—8 分钟";
  return "大量数据：可能需要更久";
}

function sumCounts(counts: Partial<Record<StorageEntityName, number>>): number {
  return Object.values(counts).reduce((total, count) => total + (typeof count === "number" ? count : 0), 0);
}

function makeRecordKey(store: StorageEntityName, recordId: StoragePrimaryKey): string {
  return `${store}:${String(recordId)}`;
}

function comparePrimaryKeys(a: StoragePrimaryKey, b: StoragePrimaryKey): number {
  return String(a).localeCompare(String(b), "en", { numeric: true });
}

function sanitizeMigrationMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
    .replace(/(xsec_token|token|access_token|api[_-]?key|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
}

function createTopWarningMessages(report: MigrationPreviewReport): string[] {
  const warnings = report.issues.filter((issue) => issue.severity === "warning").slice(0, 5).map((issue) => issue.userMessage);
  return [...new Set(warnings)];
}

function createDefaultMigrationId(generatedAt: string): string {
  return `migration_preview_${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`;
}
