import type {
  ActionCard,
  ClassificationCorrection,
  ImportBatch,
  ImportBatchItem,
  PlanCard,
  SavedItem,
  SearchLog,
  SmartAlbum
} from "@revival/shared-types";
import type {
  MigrationMetadata,
  StorageBackup,
  StorageEntityName,
  StorageRecordMap,
  StorageSnapshot,
  StoredSetting
} from "../src/contracts";

const NOW = "2026-07-15T00:00:00.000Z";
const LATER = "2026-07-15T01:00:00.000Z";

export function makeSavedItem(id = "saved-001", overrides: Partial<SavedItem> = {}): SavedItem {
  return {
    id,
    userId: "user-test",
    sourcePlatform: "xiaohongshu",
    sourceUrl: `https://example.test/items/${id}`,
    rawShareText: "测试收藏分享文本",
    title: `测试收藏 ${id}`,
    userNote: "我想之后再看这条收藏",
    contentDomain: "AI 与效率" as SavedItem["contentDomain"],
    contentSubDomain: "AI工具",
    savedIntent: "想学习" as SavedItem["savedIntent"],
    secondaryIntents: [],
    confidence: "high",
    whyThisDomain: "标题和备注都指向工具学习。",
    whyThisIntent: "用户备注表达了之后实践的意图。",
    category: "AI 与效率" as SavedItem["category"],
    subCategory: "AI工具",
    classificationConfidence: "high",
    intent: "学习一个工具方法",
    whyThisCategory: "命中 AI 与工具关键词。",
    summary: "一条用于测试的收藏。",
    keywords: ["AI", "效率", id],
    entities: [{ type: "tool", value: "Codex" }],
    searchableText: `AI 效率 Codex ${id}`,
    status: "not_started",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeImportBatch(id = "batch-001", overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id,
    source: "manual_single",
    title: `导入批次 ${id}`,
    status: "completed",
    rawCount: 1,
    importedCount: 1,
    duplicateCount: 0,
    failedCount: 0,
    createdActionCardCount: 0,
    createdAlbumCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeImportBatchItem(id = "batch-item-001", overrides: Partial<ImportBatchItem> = {}): ImportBatchItem {
  return {
    id,
    batchId: "batch-001",
    sourceUrl: `https://example.test/import/${id}`,
    title: `导入项 ${id}`,
    rawShareText: "导入项分享文本",
    userNote: "",
    status: "imported",
    createdSavedItemId: "saved-001",
    createdAt: NOW,
    ...overrides
  };
}

export function makeSmartAlbum(id = "album-001", overrides: Partial<SmartAlbum> = {}): SmartAlbum {
  return {
    id,
    title: `智能专辑 ${id}`,
    description: "用于测试的智能专辑。",
    albumView: "content_domain",
    contentDomain: "AI 与效率" as SmartAlbum["contentDomain"],
    contentSubDomain: "AI工具",
    category: "AI 与效率" as SmartAlbum["category"],
    albumType: "topic",
    keywords: ["AI", "效率"],
    savedItemIds: ["saved-001"],
    recommendedItemIds: ["saved-001"],
    whyThisAlbum: "这些收藏都围绕 AI 工具。",
    whyStartHere: "先从最短的一条开始。",
    suggestedFirstAction: "打开收藏确认工具名称。",
    priority: "medium",
    priorityScore: 60,
    status: "candidate",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeActionCard(id = "action-001", overrides: Partial<ActionCard> = {}): ActionCard {
  return {
    id,
    savedItemId: "saved-001",
    category: "AI 与效率" as ActionCard["category"],
    subCategory: "AI工具",
    title: `行动卡 ${id}`,
    goal: "复现一个最小案例。",
    whySaved: "用户想把收藏里的方法用到自己的项目。",
    nextAction: "打开原帖，记录第一个方法，并在测试项目里执行一次。",
    openOriginalFocus: ["工具名称", "第一个操作步骤"],
    output: "一张操作截图",
    estimatedTime: "20分钟",
    difficulty: "低" as ActionCard["difficulty"],
    doneCriteria: "得到一张可复查的截图。",
    avoidDoing: "不要一次性整理全部方法。",
    ifInfoMissing: "补充原帖标题和收藏原因后重新生成。",
    followUp: "明天再尝试第二个方法。",
    fields: { focus: ["工具名称", "操作步骤"] },
    tasks: [
      {
        id: "task-001",
        actionCardId: id,
        title: "复现第一个步骤",
        description: "记录输入和输出。",
        estimatedTime: "20分钟",
        status: "not_started",
        order: 1
      }
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makePlanCard(id = "plan-001", overrides: Partial<PlanCard> = {}): PlanCard {
  return {
    id,
    savedItemId: "saved-001",
    actionCardId: "action-001",
    title: `计划卡 ${id}`,
    sourceTitle: "测试收藏 saved-001",
    plannedDate: "2026-07-15",
    estimatedMinutes: 20,
    oneNextStep: "复现一个最小步骤。",
    doneCriteria: "得到一张截图。",
    status: "planned",
    reminderEnabled: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

export function makeClassificationCorrection(
  id = "correction-001",
  overrides: Partial<ClassificationCorrection> = {}
): ClassificationCorrection {
  return {
    id,
    savedItemId: "saved-001",
    previousDomain: "暂存" as ClassificationCorrection["previousDomain"],
    previousSubDomain: "待补充备注",
    previousIntent: "暂时保存" as ClassificationCorrection["previousIntent"],
    correctedDomain: "AI 与效率" as ClassificationCorrection["correctedDomain"],
    correctedSubDomain: "AI工具",
    correctedIntent: "想学习" as ClassificationCorrection["correctedIntent"],
    tags: ["AI"],
    textSnapshot: "测试收藏分享文本",
    createdAt: NOW,
    ...overrides
  };
}

export function makeSearchLog(id = "search-001", overrides: Partial<SearchLog> = {}): SearchLog {
  return {
    id,
    userId: "user-test",
    query: "AI",
    resultCount: 1,
    clickedSavedItemId: "saved-001",
    createdAt: NOW,
    ...overrides
  };
}

export function makeSetting(id = "setting-theme", overrides: Partial<StoredSetting> = {}): StoredSetting {
  return {
    id,
    key: id.replace(/^setting-/, ""),
    value: "sprout",
    category: "appearance",
    internal: false,
    updatedAt: NOW,
    schemaVersion: 1,
    ...overrides
  };
}

export function makeMigrationMetadata(id = "migration-001", overrides: Partial<MigrationMetadata> = {}): MigrationMetadata {
  return {
    id,
    sourceStorage: "localStorage",
    targetStorage: "indexedDB",
    sourceSchemaVersion: 3,
    targetSchemaVersion: 1,
    status: "not_started",
    startedAt: NOW,
    warnings: [],
    ...overrides
  };
}

export function makeBackup(id = "backup-001", overrides: Partial<StorageBackup> = {}): StorageBackup {
  const snapshot: StorageSnapshot = {
    formatVersion: 1,
    sourceStorage: "localStorage",
    sourceSchemaVersion: 3,
    createdAt: NOW,
    counts: {},
    records: {}
  };

  return {
    id,
    sourceStorage: "localStorage",
    sourceSchemaVersion: 3,
    createdAt: NOW,
    formatVersion: 1,
    snapshot,
    ...overrides
  };
}

export function makeRecordForStore<K extends StorageEntityName>(store: K, suffix = "001"): StorageRecordMap[K] {
  const id = `${store}-${suffix}`;
  switch (store) {
    case "savedItems":
      return makeSavedItem(id) as StorageRecordMap[K];
    case "importBatches":
      return makeImportBatch(id) as StorageRecordMap[K];
    case "importBatchItems":
      return makeImportBatchItem(id) as StorageRecordMap[K];
    case "smartAlbums":
      return makeSmartAlbum(id) as StorageRecordMap[K];
    case "actionCards":
      return makeActionCard(id) as StorageRecordMap[K];
    case "planCards":
      return makePlanCard(id) as StorageRecordMap[K];
    case "classificationCorrections":
      return makeClassificationCorrection(id) as StorageRecordMap[K];
    case "searchLogs":
      return makeSearchLog(id) as StorageRecordMap[K];
    case "settings":
      return makeSetting(`setting-${suffix}`, { key: suffix }) as StorageRecordMap[K];
    case "migrationMetadata":
      return makeMigrationMetadata(id) as StorageRecordMap[K];
    case "backups":
      return makeBackup(id) as StorageRecordMap[K];
  }
}

export function makeAllStoreRecords(): { [K in StorageEntityName]: StorageRecordMap[K] } {
  return {
    savedItems: makeSavedItem("saved-001"),
    importBatches: makeImportBatch("batch-001"),
    importBatchItems: makeImportBatchItem("batch-item-001"),
    smartAlbums: makeSmartAlbum("album-001"),
    actionCards: makeActionCard("action-001"),
    planCards: makePlanCard("plan-001"),
    classificationCorrections: makeClassificationCorrection("correction-001"),
    searchLogs: makeSearchLog("search-001"),
    settings: makeSetting("setting-theme"),
    migrationMetadata: makeMigrationMetadata("migration-001"),
    backups: makeBackup("backup-001")
  };
}

export const FIXTURE_DATES = {
  now: NOW,
  later: LATER
};
