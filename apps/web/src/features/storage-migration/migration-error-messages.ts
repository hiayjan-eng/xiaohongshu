import type {
  LegacySnapshotIssueCode,
  MigrationIssue,
  MigrationIssueCode,
  StorageEntityName
} from "@revival/storage-service";
import type { MigrationUiError } from "./migration-preview-types";

export interface MigrationIssuePresentation {
  title: string;
  impact: string;
  recommendation: string;
}

const ISSUE_PRESENTATIONS: Partial<Record<MigrationIssueCode | LegacySnapshotIssueCode, MigrationIssuePresentation>> = {
  KEY_MISSING: {
    title: "没有找到收藏数据",
    impact: "当前浏览器没有可供升级的主收藏数据。",
    recommendation: "先扫描或导入收藏，再回来检查。"
  },
  JSON_PARSE_FAILED: {
    title: "本地数据格式无法完整识别",
    impact: "整理后的升级预览无法生成，但原始字符串仍可保存在备份中。",
    recommendation: "先下载原始备份，暂时不要清理浏览器数据。"
  },
  CHECKSUM_UNAVAILABLE: {
    title: "浏览器暂时无法完成完整校验",
    impact: "为了避免在缺少校验时继续，当前不会开放升级。",
    recommendation: "请使用最新版 Chrome 或 Edge 后重新检查。"
  },
  RAW_CHECKSUM_MISMATCH: {
    title: "原始备份校验没有通过",
    impact: "系统无法确认原始备份内容保持一致。",
    recommendation: "重新检查当前数据，不要忽略问题继续。"
  },
  NORMALIZED_CHECKSUM_MISMATCH: {
    title: "整理后的数据校验没有通过",
    impact: "规范化数据可能与原始备份不一致。",
    recommendation: "保留原始备份，重新检查后再处理。"
  },
  UNSUPPORTED_SOURCE_SCHEMA: {
    title: "当前数据来自较早版本",
    impact: "这个版本还不能直接进入新的本地存储。",
    recommendation: "先保留备份，等待兼容处理。"
  },
  DUPLICATE_PRIMARY_KEY: {
    title: "发现重复的数据编号",
    impact: "系统不会自动覆盖其中任何一条。",
    recommendation: "后续确认需要保留的记录后再升级。"
  },
  SOURCE_IDENTITY_DUPLICATE: {
    title: "发现可能重复的收藏",
    impact: "相同来源的收藏可能被记录了多次。",
    recommendation: "先确认这些记录是否应该分别保留。"
  },
  NORMALIZED_URL_DUPLICATE: {
    title: "发现来源链接重复",
    impact: "多条收藏指向同一个规范化链接。",
    recommendation: "检查后再决定是否合并。"
  },
  SOURCE_ITEM_ID_DUPLICATE: {
    title: "发现来源编号重复",
    impact: "多条记录可能来自同一篇原帖。",
    recommendation: "确认后再继续，系统不会自动删除。"
  },
  BROKEN_REQUIRED_REFERENCE: {
    title: "有记录找不到对应的原收藏",
    impact: "行动卡、计划或导入明细的关键关系不完整。",
    recommendation: "先保留备份，后续逐条确认关联。"
  },
  BROKEN_OPTIONAL_REFERENCE: {
    title: "有可选关联需要确认",
    impact: "收藏本身仍在，但某些推荐或辅助关系不完整。",
    recommendation: "后续可确认是否保留这些辅助关系。"
  },
  TEXT_REPAIR_PENDING: {
    title: "部分旧标题仍需单独修复",
    impact: "这不会影响原始备份，但标题显示可能仍有异常。",
    recommendation: "存储升级与文本修复分开处理。"
  },
  TARGET_RECORD_CONFLICT: {
    title: "新存储中存在不同内容",
    impact: "继续可能覆盖已有记录，因此当前会停止。",
    recommendation: "先确认目标数据来源，再重新检查。"
  },
  REQUIRES_MANUAL_REVIEW: {
    title: "有记录需要人工确认",
    impact: "系统不会替你决定如何处理这部分数据。",
    recommendation: "查看安全明细后再进入后续阶段。"
  },
  NORMALIZED_SNAPSHOT_MISSING: {
    title: "暂时无法生成升级数据",
    impact: "原始备份仍可用，但当前不能安全升级。",
    recommendation: "先下载原始备份，再处理结构问题。"
  },
  BACKUP_ENVELOPE_INVALID: {
    title: "备份结构需要重新检查",
    impact: "系统没有开始任何写入。",
    recommendation: "保留当前页面的数据并重新检查。"
  }
};

export const STORAGE_ENTITY_LABELS: Record<StorageEntityName, string> = {
  savedItems: "收藏",
  importBatches: "扫描与导入批次",
  importBatchItems: "导入明细",
  smartAlbums: "智能专辑",
  actionCards: "行动卡",
  planCards: "计划卡",
  classificationCorrections: "分类纠正",
  searchLogs: "搜索记录",
  settings: "主题与成就",
  migrationMetadata: "升级记录",
  backups: "原始备份"
};

const EXECUTION_ERROR_MESSAGES: Record<string, string> = {
  MIGRATION_LOCK_UNAVAILABLE: "当前无法取得安全升级锁。请确认使用最新版 Chrome 或 Edge，并关闭其他正在升级的页面后重试。",
  MIGRATION_LOCK_TIMEOUT: "等待安全升级锁超时。当前没有继续写入，请稍后重试。",
  MIGRATION_LOCK_HELD: "另一个页面正在处理这次升级，请等待它完成后刷新状态。",
  MIGRATION_ACTIVE_SESSION_EXISTS: "当前已有一次升级尚未处理完成，不能开始新的升级。",
  MIGRATION_USER_CONFIRMATION_REQUIRED: "请完成备份下载和四项确认后再开始升级。",
  MIGRATION_PREVIEW_BLOCKED: "当前仍有数据需要确认，暂时不能开始升级。",
  MIGRATION_PLAN_MISMATCH: "当前检查结果与升级计划不一致，请重新检查当前数据。",
  MIGRATION_SOURCE_MISMATCH: "当前收藏数据或备份已经发生变化，请重新检查并下载新的备份。",
  MIGRATION_BACKUP_INVALID: "原始备份未通过检查，因此没有继续写入收藏数据。",
  MIGRATION_BACKUP_PERSIST_FAILED: "恢复备份没有保存完整，因此没有继续写入收藏数据。",
  MIGRATION_CRYPTO_UNAVAILABLE: "当前浏览器无法完成安全校验，请使用最新版 Chrome 或 Edge。",
  MIGRATION_TARGET_UNAVAILABLE: "新存储暂时无法打开，当前数据没有被修改。",
  MIGRATION_TARGET_SCHEMA_MISMATCH: "新存储版本与当前升级计划不一致，升级已经停止。",
  MIGRATION_TARGET_NOT_EMPTY: "新存储中已经存在其他数据。为了避免覆盖，升级已停止。",
  MIGRATION_UNSUPPORTED_TARGET: "当前环境不支持这次本地数据升级。",
  MIGRATION_WRITE_FAILED: "写入过程中遇到问题，新存储没有被启用。",
  MIGRATION_VERIFY_FAILED: "写入后的校验没有通过，新存储没有被启用。",
  MIGRATION_CHECKPOINT_INVALID: "升级记录不完整，当前不会继续覆盖新存储。",
  MIGRATION_CANCELLED: "升级已经安全停止，新存储尚未启用。",
  MIGRATION_RESUME_CONFLICT: "新存储中的数据与升级记录不一致，不能自动继续。建议先恢复到升级前。",
  MIGRATION_ALREADY_COMPLETED: "这次升级已经完成，不需要再次继续。",
  MIGRATION_ALREADY_ACTIVATED: "新存储已被标记为启用，当前流程不会继续修改。",
  MIGRATION_ROLLBACK_NOT_AVAILABLE: "当前状态不能安全恢复到升级前。",
  MIGRATION_ROLLBACK_FAILED: "恢复没有全部完成。原始备份仍然保留，请继续恢复，不要清理浏览器数据。",
  MIGRATION_CHECKSUM_MISMATCH: "备份或新存储校验没有通过，当前不会自动继续。",
  MIGRATION_NOT_FOUND: "没有找到对应的升级记录。"
};

export function getIssuePresentation(code: MigrationIssueCode | LegacySnapshotIssueCode): MigrationIssuePresentation {
  return ISSUE_PRESENTATIONS[code] ?? {
    title: "有一项数据需要确认",
    impact: "当前不会修改或覆盖任何收藏。",
    recommendation: "先查看安全明细并保留原始备份。"
  };
}

export function toSafeMigrationUiError(error: unknown): MigrationUiError {
  const code = readSafeErrorCode(error);
  const executionMessage = EXECUTION_ERROR_MESSAGES[code];
  if (executionMessage) {
    return {
      code,
      message: executionMessage,
      recoverable: readRecoverable(error)
    };
  }
  if (code === "STORAGE_UNAVAILABLE") {
    return { code, message: "无法读取当前浏览器的本地数据。当前没有修改任何内容。" };
  }
  if (code === "STORAGE_EXPORT_FAILED") {
    return { code, message: "备份文件暂时无法生成，请稍后重试。" };
  }
  return { code, message: "检查没有完成，但当前数据没有被修改。请重新检查。" };
}

export function getSafeIssueRecordLabel(issue: Pick<MigrationIssue, "store" | "recordId" | "field">): string {
  const storeLabel = issue.store ? STORAGE_ENTITY_LABELS[issue.store] : "本地数据";
  const id = sanitizeIdentifier(issue.recordId);
  const field = issue.field ? sanitizeIdentifier(issue.field) : "";
  return [storeLabel, id, field].filter(Boolean).join(" · ");
}

function readSafeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "INSPECTION_FAILED";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? code : "INSPECTION_FAILED";
}

function readRecoverable(error: unknown): boolean | undefined {
  if (!error || typeof error !== "object") return undefined;
  const recoverable = (error as { recoverable?: unknown }).recoverable;
  return typeof recoverable === "boolean" ? recoverable : undefined;
}

function sanitizeIdentifier(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, "_").slice(0, 72);
}
