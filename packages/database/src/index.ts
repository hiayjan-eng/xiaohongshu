import { classifyAndGenerateActionCard } from "@revival/ai-service";
import {
  APP_SCHEMA_VERSION,
  CATEGORIES,
  DEFAULT_USER,
  type ActionCard,
  type ActionCardDraft,
  type AiClassificationResult,
  type AppState,
  type Category,
  type ClassificationCorrection,
  type ClassificationConfidence,
  type ItemStatus,
  type PlanCard,
  type SavedItem,
  type SavedIntent,
  type SearchLog,
  type ShareInput,
  type Task
} from "@revival/shared-types";

export const STORAGE_KEY = "collection-revival-system:v1";

export type LegacyAppStateReadStatus =
  | "loaded"
  | "missing"
  | "invalid_json"
  | "invalid_data"
  | "unsupported_schema";

export interface LegacyAppStateReadResult {
  status: LegacyAppStateReadStatus;
  state?: AppState;
  sourceSchemaVersion?: number;
}

/** Reads and normalizes legacy state without writing fallback data. */
export function readLegacyAppState(storage: Pick<Storage, "getItem">): LegacyAppStateReadResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { status: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid_json" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "invalid_data" };
  }

  const sourceSchemaVersion = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (
    sourceSchemaVersion !== undefined &&
    (!Number.isInteger(sourceSchemaVersion) || Number(sourceSchemaVersion) < 1 || Number(sourceSchemaVersion) > APP_SCHEMA_VERSION)
  ) {
    return {
      status: "unsupported_schema",
      sourceSchemaVersion: typeof sourceSchemaVersion === "number" ? sourceSchemaVersion : undefined
    };
  }

  try {
    return {
      status: "loaded",
      state: normalizeAppState(parsed as AppState),
      sourceSchemaVersion: typeof sourceSchemaVersion === "number" ? sourceSchemaVersion : undefined
    };
  } catch {
    return {
      status: "invalid_data",
      sourceSchemaVersion: typeof sourceSchemaVersion === "number" ? sourceSchemaVersion : undefined
    };
  }
}

export function loadAppState(storage?: Pick<Storage, "getItem" | "setItem">): AppState {
  if (!storage) return createInitialDemoData();

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = createInitialDemoData();
    storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  try {
    return normalizeAppState(JSON.parse(raw) as AppState);
  } catch {
    const initial = createInitialDemoData();
    storage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
}

export function persistAppState(state: AppState, storage?: Pick<Storage, "setItem">): void {
  storage?.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createSavedItemRecord(
  userId: string,
  input: ShareInput,
  aiResult: AiClassificationResult,
  now = new Date()
): SavedItem {
  const createdAt = now.toISOString();
  const contentDomain = normalizeCategoryValue(aiResult.contentDomain ?? aiResult.category);
  const contentSubDomain = cleanLegacyText(aiResult.contentSubDomain || aiResult.subCategory || inferSubCategoryFromInput(input, contentDomain));
  const savedIntent = normalizeSavedIntent(aiResult.savedIntent ?? aiResult.intent);
  const secondaryIntents = uniqueSavedIntents([...(aiResult.secondaryIntents ?? []), savedIntent]).filter((intent) => intent !== savedIntent);
  const confidence = normalizeConfidence(aiResult.confidence, contentDomain);
  const rawTitle = input.title || input.rawShareText;
  const cleanedTitle = normalizeStoredTitle(input.title, input.rawShareText || aiResult.actionCard?.title);
  const displayTitle = pickDisplayTitle({ cleanedTitle, rawTitle });
  const rawText = input.rawText ?? input.rawShareText;
  const source = analyzeSourceUrl(input.sourceUrl);
  const normalized = normalizeSavedContent(rawTitle, rawText, input.author);

  return {
    id: createId("item"),
    userId,
    sourcePlatform: detectPlatform(input.sourceUrl),
    sourceUrl: input.sourceUrl,
    canonicalSourceUrl: input.canonicalSourceUrl || source.canonicalSourceUrl,
    sourceId: input.sourceId || source.sourceId,
    sourceUrlStatus: input.sourceUrlStatus || source.status,
    lastUrlCheckedAt: input.lastUrlCheckedAt || createdAt,
    userCorrectedSourceUrl: input.userCorrectedSourceUrl,
    rawShareText: input.rawShareText,
    rawText,
    normalizedContentText: normalized.normalizedContent,
    normalizedTitle: normalized.normalizedTitle,
    normalizedContent: normalized.normalizedContent,
    normalizationVersion: normalized.normalizationVersion,
    normalizationWarnings: normalized.normalizationWarnings,
    author: input.author,
    title: displayTitle,
    userNote: input.userNote,
    contentDomain,
    contentSubDomain,
    savedIntent,
    secondaryIntents,
    confidence,
    whyThisDomain: aiResult.whyThisDomain || aiResult.whyThisCategory || "基于标题、分享文案和备注判断内容主题。",
    whyThisIntent: aiResult.whyThisIntent || aiResult.intent || "基于用户备注和内容线索推断收藏用途。",
    classificationReason: aiResult.classificationReason || aiResult.whyThisDomain || aiResult.whyThisCategory,
    positiveEvidence: aiResult.positiveEvidence ?? [],
    negativeEvidence: aiResult.negativeEvidence ?? [],
    conflictingEvidence: aiResult.conflictingEvidence ?? [],
    dominantIntent: aiResult.dominantIntent || savedIntent,
    classificationShadow: aiResult.classificationShadow,
    category: contentDomain,
    subCategory: contentSubDomain,
    classificationConfidence: confidence,
    intent: savedIntent,
    whyThisCategory: aiResult.whyThisDomain || aiResult.whyThisCategory || "基于标题、分享文案和备注判断内容主题。",
    rawTitle,
    cleanedTitle,
    displayTitle,
    textNormalizationVersion: 3,
    summary: normalizeStoredSummary(aiResult.summary, contentDomain),
    keywords: aiResult.keywords ?? [],
    entities: aiResult.entities ?? [],
    searchableText: aiResult.searchableText || buildSearchableText({ ...input, title: displayTitle }, contentDomain, contentSubDomain, savedIntent, aiResult.keywords ?? [], aiResult.entities ?? []),
    status: "not_started",
    createdAt,
    importedAt: createdAt,
    updatedAt: createdAt
  };
}

export function createActionCardRecord(
  savedItem: SavedItem,
  draft: ActionCardDraft,
  now = new Date()
): ActionCard {
  const actionCardId = createId("card");
  const createdAt = now.toISOString();
  const tasks = (draft.tasks ?? []).map<Task>((task, index) => ({
    id: `task_${actionCardId}_${index + 1}`,
    actionCardId,
    title: task.title,
    description: task.description,
    estimatedTime: task.estimatedTime,
    dueDate: task.dueDate,
    status: "not_started",
    order: index + 1
  }));

  return {
    id: actionCardId,
    savedItemId: savedItem.id,
    category: savedItem.contentDomain,
    subCategory: savedItem.contentSubDomain,
    title: normalizeStoredTitle(draft.title, savedItem.title),
    goal: draft.goal,
    whySaved: draft.whySaved,
    nextAction: draft.nextAction,
    openOriginalFocus: draft.openOriginalFocus ?? [],
    output: draft.output,
    estimatedTime: draft.estimatedTime,
    difficulty: draft.difficulty,
    doneCriteria: draft.doneCriteria,
    avoidDoing: draft.avoidDoing,
    ifInfoMissing: draft.ifInfoMissing,
    followUp: draft.followUp,
    fields: draft.structuredFields ?? {},
    tasks,
    generatedFromIntent: draft.generatedFromIntent,
    templateVersion: draft.templateVersion,
    createdAt,
    updatedAt: createdAt
  };
}

export function createImportedRecords(
  userId: string,
  input: ShareInput,
  aiResult: AiClassificationResult,
  now = new Date()
): { savedItem: SavedItem; actionCard: ActionCard } {
  const savedItem = createSavedItemRecord(userId, input, aiResult, now);
  const actionCard = createActionCardRecord(savedItem, aiResult.actionCard, now);
  return { savedItem, actionCard };
}

export function createSearchLog(userId: string, query: string, resultCount: number, clickedSavedItemId?: string): SearchLog {
  return {
    id: createId("search"),
    userId,
    query,
    resultCount,
    clickedSavedItemId,
    createdAt: new Date().toISOString()
  };
}

export function updateItemStatus(items: SavedItem[], id: string, status: ItemStatus): SavedItem[] {
  const updatedAt = new Date().toISOString();
  return items.map((item) => (item.id === id ? { ...item, status, updatedAt } : item));
}

export function createInitialDemoData(): AppState {
  const now = new Date();
  const records = DEMO_SEED_INPUTS.map((input, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - index);
    return createImportedRecords(DEFAULT_USER.id, input, classifyAndGenerateActionCard(input), date);
  });

  return {
    schemaVersion: APP_SCHEMA_VERSION,
    user: DEFAULT_USER,
    savedItems: records.map((record, index) => ({
      ...record.savedItem,
      status: DEMO_STATUSES[index] ?? "not_started"
    })),
    actionCards: [],
    searchLogs: [],
    smartAlbums: [],
    planCards: [],
    classificationCorrections: [],
    importBatches: [],
    importBatchItems: []
  };
}

const DEMO_SEED_INPUTS: ShareInput[] = [
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-capcut-7days",
    title: "剪映新手 7 天剪辑入门",
    rawShareText: "手机剪辑教程，适合短视频入门，包含开头 3 秒、转场、字幕和节奏练习。",
    userNote: "做账号之前先练一条 30 秒视频"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-ai-tools-workflow",
    title: "AI工具日常工作流入门",
    rawShareText: "AI 工具教程，讲提示词、资料整理、表格总结和自动化流程，适合办公效率提升。",
    userNote: "想整理成自己的每日工作 SOP"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-english-speaking",
    title: "英语口语 14 天影子跟读练习",
    rawShareText: "英语学习方法，适合通勤练习，包含跟读、复述和每日 15 分钟训练。",
    userNote: "先从早餐后 15 分钟开始"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-writing-note",
    title: "写作练习：把生活观察写成小红书笔记",
    rawShareText: "写作教程，包含标题、开头、故事结构和练习任务，适合内容创作者入门。",
    userNote: "可以用来写产品日记"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-skill-photography-light",
    title: "手机摄影自然光构图训练",
    rawShareText: "摄影入门课程，讲自然光、构图、人物拍摄和后期调色练习。",
    userNote: "周末拍咖啡店照片时试一下"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-dali-three-days",
    title: "大理 3 天慢旅行路线",
    rawShareText: "大理旅行攻略，包含古城、洱海、喜洲路线、交通和适合季节。",
    userNote: "下次年假可以参考"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-shenzhen-weekend",
    title: "深圳周末展览和咖啡路线",
    rawShareText: "适合周末去的深圳展览路线，附近还有咖啡店和散步点，不用请假。",
    userNote: "想找一个轻松周末安排"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-food-coffee-brunch",
    title: "广州安静咖啡店 brunch 探店",
    rawShareText: "咖啡店探店，适合下午茶、brunch、聊天和拍照，人均预算 80 左右。",
    userNote: "适合约朋友周日下午去"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-art-exhibition",
    title: "上海近期展览路线清单",
    rawShareText: "上海展览、城市散步和美术馆路线，适合周末半日游。",
    userNote: "可以和摄影练习一起安排"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-travel-hiking-weekend",
    title: "杭州周边徒步一日路线",
    rawShareText: "周边游徒步路线，包含交通、补给、景点、预算和避坑提醒。",
    userNote: "天气好时先走轻松路线"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-recipe-lowcal-dinner",
    title: "低卡晚餐：空气炸锅鸡胸肉便当",
    rawShareText: "减脂餐菜谱，空气炸锅做饭，鸡胸肉、蔬菜、玉米和工作日晚餐备餐。",
    userNote: "下班不想再点外卖"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-life-closet-storage",
    title: "衣柜换季收纳整理法",
    rawShareText: "收纳教程，衣柜整理、分区、断舍离和换季家居生活清单。",
    userNote: "周六上午整理衣柜"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-life-rental-makeover",
    title: "租房改造低预算氛围布置",
    rawShareText: "租房改造、软装、灯光、地毯和家居布置，预算不高也能提升氛围。",
    userNote: "先买灯和收纳盒，不动硬装"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-recipe-breakfast",
    title: "10 分钟高蛋白早餐备餐",
    rawShareText: "早餐菜谱，鸡蛋、酸奶、燕麦和水果，适合工作日前一晚准备。",
    userNote: "先试三天，不追求复杂"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-life-kitchen-clean",
    title: "厨房清洁周末 30 分钟流程",
    rawShareText: "清洁 SOP，厨房油污、台面、水槽和冰箱整理，适合周末快速完成。",
    userNote: "周末先做一次最小清洁"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-cover-design",
    title: "小红书封面标题排版参考",
    rawShareText: "封面、标题、审美参考和内容结构，适合做选题库和账号运营素材。",
    userNote: "之后做产品案例封面"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-topic-bank",
    title: "30 个生活方式账号选题方向",
    rawShareText: "选题灵感，包含账号定位、系列内容、爆款标题和可复用结构。",
    userNote: "可以拆成一周内容计划"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-copywriting",
    title: "种草文案开头 20 个模板",
    rawShareText: "文案素材，包含标题、开头、转折和行动号召，适合写小红书笔记。",
    userNote: "写工具推荐时可以参考"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-shooting-angle",
    title: "手机拍摄角度和运镜灵感",
    rawShareText: "拍摄灵感、脚本、构图、俯拍和近景参考，适合探店和做饭视频。",
    userNote: "下次拍早餐或咖啡店试试"
  },
  {
    sourceUrl: "https://www.xiaohongshu.com/explore/demo-creative-account-operation",
    title: "小红书账号运营复盘模板",
    rawShareText: "账号运营、内容结构、数据复盘、选题和封面优化，适合每周复盘。",
    userNote: "周日晚上用来整理账号"
  }
];

const DEMO_STATUSES: ItemStatus[] = [
  "scheduled_today",
  "in_progress",
  "not_started",
  "not_started",
  "snoozed",
  "not_started",
  "scheduled_today",
  "not_started",
  "not_started",
  "snoozed",
  "scheduled_today",
  "not_started",
  "in_progress",
  "not_started",
  "not_started",
  "not_started",
  "scheduled_today",
  "not_started",
  "in_progress",
  "not_started"
];
function detectPlatform(sourceUrl: string): SavedItem["sourcePlatform"] {
  if (/xiaohongshu\.com|xhslink\.com/i.test(sourceUrl)) return "xiaohongshu";
  if (!sourceUrl) return "manual";
  return "other";
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}


export function normalizeAppState(state: AppState): AppState {
  const savedItems = (state.savedItems ?? []).map(normalizeSavedItem);
  const actionCards = (state.actionCards ?? []).map((card) => normalizeActionCard(card, savedItems.find((item) => item.id === card.savedItemId)));
  return {
    ...state,
    schemaVersion: APP_SCHEMA_VERSION,
    savedItems,
    actionCards,
    planCards: (state.planCards ?? []).map(normalizePlanCard),
    classificationCorrections: state.classificationCorrections ?? [],
    searchLogs: state.searchLogs ?? [],
    smartAlbums: (state.smartAlbums ?? []).map(normalizeSmartAlbum),
    importBatches: (state.importBatches ?? []).map(normalizeImportBatch),
    importBatchItems: (state.importBatchItems ?? []).map(normalizeImportBatchItem)
  };
}

function normalizeItemStatus(status: unknown): SavedItem["status"] {
  if (status === "today") return "scheduled_today";
  if (status === "scheduled_today" || status === "scheduled" || status === "in_progress" || status === "completed" || status === "snoozed") return status;
  return "not_started";
}
function normalizeSavedItem(item: SavedItem): SavedItem {
  const raw = item as SavedItem & {
    contentDomain?: unknown;
    contentSubDomain?: string;
    savedIntent?: unknown;
    secondaryIntents?: unknown;
    confidence?: unknown;
    whyThisDomain?: string;
    whyThisIntent?: string;
    classificationReason?: string;
    positiveEvidence?: unknown;
    negativeEvidence?: unknown;
    conflictingEvidence?: unknown;
    dominantIntent?: string;
    subCategory?: string;
    whyThisCategory?: string;
    category?: string;
    intent?: string;
  };
  const contentDomain = normalizeCategoryValue(raw.contentDomain ?? raw.category);
  const contentSubDomain = contentDomain === "暂存" && (!raw.contentSubDomain && (!raw.subCategory || raw.subCategory === "其他"))
    ? "待补充备注"
    : cleanLegacyText(raw.contentSubDomain || raw.subCategory || inferSubCategoryFromItem({ ...item, category: contentDomain }));
  const savedIntent = normalizeSavedIntent(raw.savedIntent ?? raw.intent);
  const confidence = normalizeConfidence(raw.confidence ?? item.classificationConfidence, contentDomain);
  const whyThisDomain = raw.whyThisDomain || raw.whyThisCategory || "基于标题、分享文案和备注综合判断内容主题。";
  const whyThisIntent = raw.whyThisIntent || raw.intent || "基于用户备注和内容线索推断收藏用途。";

  const rawTitle = (item.rawTitle || item.title || item.rawShareText || "").normalize("NFC");
  const rawText = item.rawText ?? item.rawShareText ?? "";
  const cleanedTitle = normalizeStoredTitle(item.cleanedTitle || item.title, item.rawShareText);
  const displayTitle = pickDisplayTitle({
    userEditedTitle: item.userEditedTitle,
    cleanedTitle,
    rawTitle
  });

  const source = analyzeSourceUrl(item.userCorrectedSourceUrl || item.sourceUrl);
  const normalized = normalizeSavedContent(rawTitle, rawText, item.author);

  return {
    ...item,
    sourcePlatform: detectPlatform(item.userCorrectedSourceUrl || item.sourceUrl),
    canonicalSourceUrl: item.userCorrectedSourceUrl ? source.canonicalSourceUrl : item.canonicalSourceUrl || source.canonicalSourceUrl,
    sourceId: item.userCorrectedSourceUrl ? source.sourceId : item.sourceId || source.sourceId,
    sourceUrlStatus: item.sourceUrlStatus === "unavailable" ? "unavailable" : item.sourceUrlStatus || source.status,
    lastUrlCheckedAt: item.lastUrlCheckedAt || item.updatedAt || item.createdAt,
    rawText,
    normalizedTitle: item.normalizationVersion === NORMALIZATION_VERSION && item.normalizedTitle !== undefined ? item.normalizedTitle : normalized.normalizedTitle,
    normalizedContent: item.normalizationVersion === NORMALIZATION_VERSION && item.normalizedContent !== undefined ? item.normalizedContent : normalized.normalizedContent,
    normalizedContentText: item.normalizationVersion === NORMALIZATION_VERSION && item.normalizedContent !== undefined ? item.normalizedContent : normalized.normalizedContent,
    normalizationVersion: NORMALIZATION_VERSION,
    normalizationWarnings: item.normalizationVersion === NORMALIZATION_VERSION ? item.normalizationWarnings ?? [] : normalized.normalizationWarnings,
    status: normalizeItemStatus(item.status),
    contentDomain,
    contentSubDomain,
    savedIntent,
    secondaryIntents: Array.isArray(raw.secondaryIntents) ? uniqueSavedIntents(raw.secondaryIntents) : [],
    confidence,
    whyThisDomain,
    whyThisIntent,
    classificationReason: raw.classificationReason || whyThisDomain,
    positiveEvidence: Array.isArray(raw.positiveEvidence) ? raw.positiveEvidence.filter(isString) : [],
    negativeEvidence: Array.isArray(raw.negativeEvidence) ? raw.negativeEvidence.filter(isString) : [],
    conflictingEvidence: Array.isArray(raw.conflictingEvidence) ? raw.conflictingEvidence.filter(isString) : [],
    dominantIntent: raw.dominantIntent || savedIntent,
    rawTitle,
    cleanedTitle,
    displayTitle,
    textNormalizationVersion: item.textNormalizationVersion ?? 2,
    category: contentDomain,
    subCategory: contentSubDomain,
    title: displayTitle,
    summary: normalizeStoredSummary(item.summary, contentDomain),
    intent: savedIntent,
    whyThisCategory: whyThisDomain,
    classificationConfidence: confidence,
    searchableText: item.searchableText || buildSearchableText(item, contentDomain, contentSubDomain, savedIntent, item.keywords ?? [], item.entities ?? [])
  };
}

function normalizePlanCard(card: PlanCard): PlanCard {
  return {
    ...card,
    sourceTitle: card.sourceTitle || "来源收藏待补充",
    estimatedMinutes: Number.isFinite(card.estimatedMinutes) ? card.estimatedMinutes : 20,
    status: card.status === "doing" || card.status === "done" || card.status === "cancelled" ? card.status : "planned",
    reminderEnabled: Boolean(card.reminderEnabled)
  };
}

function normalizeActionCard(card: ActionCard, item?: SavedItem): ActionCard {
  const raw = card as ActionCard & Partial<Pick<ActionCard, "whySaved" | "openOriginalFocus" | "output" | "doneCriteria" | "avoidDoing" | "ifInfoMissing" | "followUp" | "subCategory" | "generatedFromIntent" | "templateVersion">>;
  const category = normalizeCategoryValue(card.category);
  const subCategory = raw.subCategory && raw.subCategory !== "其他" ? raw.subCategory : item?.subCategory || (category === "暂存" ? "待补充备注" : "主题整理");
  return {
    ...card,
    category,
    subCategory,
    title: normalizeStoredTitle(card.title, item?.title || item?.rawShareText),
    whySaved: raw.whySaved || item?.intent || "这条收藏可以转成一个小行动。",
    openOriginalFocus: raw.openOriginalFocus && raw.openOriginalFocus.length > 0 ? raw.openOriginalFocus : ["原帖标题", "作者给的步骤", "评论区补充"],
    output: raw.output || "一个可保存的小产出",
    doneCriteria: raw.doneCriteria || "完成卡片里的第一个具体动作。",
    avoidDoing: raw.avoidDoing || "不要一次整理太多收藏。",
    ifInfoMissing: raw.ifInfoMissing || "如果信息不足，先补一句你为什么收藏它。",
    followUp: raw.followUp || "完成后再决定是否加入计划或专辑。",
    generatedFromIntent: raw.generatedFromIntent || "copy_once",
    templateVersion: raw.templateVersion || "legacy-category-v1"
  };
}

function normalizeSmartAlbum(album: NonNullable<AppState["smartAlbums"]>[number]): NonNullable<AppState["smartAlbums"]>[number] {
  const raw = album as NonNullable<AppState["smartAlbums"]>[number] & { priority?: unknown; priorityScore?: number; recommendedItemIds?: string[]; albumView?: unknown; contentDomain?: unknown; contentSubDomain?: string; savedIntent?: unknown };
  const priorityScore = raw.priorityScore ?? album.savedItemIds.length * 10 + album.keywords.length;
  const albumView = raw.albumView === "saved_intent" ? "saved_intent" : "content_domain";
  const contentDomain = normalizeCategoryValue(raw.contentDomain ?? album.category);
  const savedIntent = albumView === "saved_intent" ? normalizeSavedIntent(raw.savedIntent ?? album.albumType) : raw.savedIntent ? normalizeSavedIntent(raw.savedIntent) : undefined;
  const keywords = Array.isArray(album.keywords) ? album.keywords : [];
  const savedItemIds = Array.isArray(album.savedItemIds) ? album.savedItemIds : [];
  const recommendedItemIds = raw.recommendedItemIds ?? savedItemIds.slice(0, 3);
  return {
    ...album,
    albumView,
    contentDomain,
    contentSubDomain: raw.contentSubDomain || keywords[0] || album.albumType || "主题整理",
    savedIntent,
    category: contentDomain,
    albumType: album.albumType || (albumView === "saved_intent" ? "intent_album" : "domain_album"),
    keywords,
    savedItemIds,
    recommendedItemIds,
    whyThisAlbum: album.whyThisAlbum || (albumView === "saved_intent" ? "这些收藏的用途相近，适合放在同一个用途视角里查看。" : "这些收藏讲的是相近主题，适合放在同一个主题视角里查看。"),
    whyStartHere: album.whyStartHere || "先从最近保存、信息更完整的 3 条开始。",
    suggestedFirstAction: album.suggestedFirstAction || "先挑一条真正想复活的收藏，再按用途生成行动卡。",
    priority: raw.priority === "high" || raw.priority === "medium" || raw.priority === "low" ? raw.priority : priorityScore >= 36 ? "high" : priorityScore >= 18 ? "medium" : "low",
    priorityScore,
    autoCollectEnabled: album.autoCollectEnabled ?? album.status === "confirmed",
    mediumMatchRequiresApproval: album.mediumMatchRequiresApproval ?? true,
    suggestedItemIds: album.suggestedItemIds ?? [],
    manuallyAddedItemIds: album.manuallyAddedItemIds ?? [],
    manuallyRemovedItemIds: album.manuallyRemovedItemIds ?? [],
    matchProfile: album.matchProfile ?? {
      contentDomain,
      contentSubDomain: raw.contentSubDomain || keywords[0] || album.albumType || "主题整理",
      savedIntent,
      keywords,
      entityValues: [],
      positiveExamples: savedItemIds.slice(0, 3),
      negativeExamples: []
    },
    schemaVersion: album.schemaVersion ?? 2
  };
}

function normalizeImportBatch(batch: NonNullable<AppState["importBatches"]>[number]): NonNullable<AppState["importBatches"]>[number] {
  return {
    ...batch,
    scanSummary: batch.scanSummary
  };
}

function normalizeImportBatchItem(item: NonNullable<AppState["importBatchItems"]>[number]): NonNullable<AppState["importBatchItems"]>[number] {
  const rawTitle = item.rawTitle || item.title || item.rawShareText || item.visibleText || "";
  const cleanedTitle = cleanScannedTitle(item.cleanedTitle || rawTitle, item.rawShareText || item.visibleText || "");
  const displayTitle = pickDisplayTitle({
    userEditedTitle: item.userEditedTitle,
    cleanedTitle,
    rawTitle
  });
  return {
    ...item,
    rawTitle,
    cleanedTitle,
    displayTitle,
    title: displayTitle,
    rawShareText: cleanScannedText(item.rawShareText || ""),
    visibleText: item.visibleText ? cleanScannedText(item.visibleText) : item.visibleText,
    textNormalizationVersion: item.textNormalizationVersion ?? 2
  };
}

function inferSubCategoryFromItem(item: SavedItem): string {
  return item.keywords[0] || item.category;
}

function normalizeCategoryValue(value: unknown): Category {
  if (typeof value === "string" && value !== "其他" && (CATEGORIES as readonly string[]).includes(value)) return value as Category;
  return "暂存";
}

function normalizeStoredTitle(title: string, fallback?: string): string {
  const cleaned = cleanLegacyText(title).replace(/其他行动卡行动卡|行动卡行动卡|其他行动卡/g, "").trim();
  if (cleaned) return cleaned;
  const fallbackText = cleanLegacyText(fallback ?? "").replace(/https?:\/\/\S+/g, "").trim().slice(0, 20);
  return fallbackText || "待整理收藏";
}

function pickDisplayTitle(input: { userEditedTitle?: string; cleanedTitle?: string; rawTitle?: string }): string {
  const edited = cleanLegacyText(input.userEditedTitle ?? "");
  if (edited) return edited;
  const cleaned = normalizeStoredTitle(input.cleanedTitle ?? "", input.rawTitle);
  if (cleaned && cleaned !== "待整理收藏") return cleaned;
  const raw = normalizeStoredTitle(input.rawTitle ?? "");
  return raw && raw !== "待整理收藏" ? raw : "标题待补充";
}

function normalizeStoredSummary(summary: string, category: Category): string {
  const cleaned = cleanLegacyText(summary);
  if (category === "暂存" || /可能和.*http|其他行动卡|行动卡行动卡/.test(cleaned)) {
    return "信息还不够完整，补充一句收藏原因后可以重新整理。";
  }
  return cleaned || "信息还不够完整，补充一句收藏原因后可以重新整理。";
}

function cleanLegacyText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
function inferSubCategoryFromInput(input: ShareInput, category: Category): string {
  const text = [input.title, input.rawShareText, input.userNote].join(" ");
  if (category === "内容创作") {
    if (/剪辑|视频|短视频|运镜/.test(text)) return "视频剪辑";
    if (/封面|排版/.test(text)) return "封面设计";
    if (/选题/.test(text)) return "选题策划";
    if (/运营|账号/.test(text)) return "账号运营";
  }
  if (category === "AI 与效率") {
    if (/prompt|提示词|多角色|圆桌|Jung|Mankiw|Munger|Musk/i.test(text)) return "Prompt 工程";
    if (/决策|战略|工作安排|时间分配/.test(text)) return "决策辅助";
    if (/工作流|自动化|SOP/.test(text)) return "自动化工作流";
    return "AI 工具";
  }
  if (category === "情绪与关系") return /关系|亲密|表达|需求/.test(text) ? "亲密关系" : "自我观察";
  if (category === "工作与职业") {
    if (/招聘|岗位|简历|面试/.test(text)) return "招聘求职";
    if (/创业公司|团队|合伙人|加入/.test(text)) return "创业团队";
    return "职场成长";
  }
  if (category === "商业与经营") {
    if (/独立站/.test(text)) return "独立站运营";
    if (/跨境|电商/.test(text)) return "跨境电商";
    if (/选品|定价|客单价|毛利|溢价/.test(text)) return "选品与定价";
    return "商业案例";
  }
  return category === "暂存" ? "待补充备注" : category;
}

function normalizeConfidence(value: unknown, category: Category): ClassificationConfidence {
  if (value === "high" || value === "medium" || value === "low") return value;
  return category === "暂存" ? "low" : "medium";
}

function normalizeSavedIntent(value: unknown): SavedIntent {
  if (value === "想学习" || value === "想复现" || value === "想去" || value === "想买" || value === "想做" || value === "内容创作参考" || value === "工作决策参考" || value === "求职关注" || value === "创业团队参考" || value === "以后联系" || value === "商业案例参考" || value === "情绪共鸣" || value === "以后查阅" || value === "暂时保存") {
    return value;
  }
  const text = String(value ?? "");
  if (/招聘|求职|岗位|简历|面试/.test(text)) return "求职关注";
  if (/创业团队|加入公司|合伙人|以后联系/.test(text)) return "创业团队参考";
  if (/商业案例|独立站|跨境|选品|定价|客单价|毛利/.test(text)) return "商业案例参考";
  if (/创作|选题|封面|写文章|写作|内容/.test(text)) return "内容创作参考";
  if (/工作|决策|效率|SOP|流程|自动化/.test(text)) return "工作决策参考";
  if (/复现|照着|模仿|做一次/.test(text)) return "想复现";
  if (/学习|教程|学会|练习/.test(text)) return "想学习";
  if (/去|旅行|路线|探店|展览|咖啡|餐厅/.test(text)) return "想去";
  if (/买|种草|价格|单品|购物/.test(text)) return "想买";
  if (/情绪|关系|共鸣|触动|复盘/.test(text)) return "情绪共鸣";
  if (/做|执行|尝试/.test(text)) return "想做";
  return "以后查阅";
}

function uniqueSavedIntents(values: unknown[]): SavedIntent[] {
  const seen = new Set<SavedIntent>();
  values.forEach((value) => seen.add(normalizeSavedIntent(value)));
  return [...seen];
}

function buildSearchableText(input: Pick<ShareInput, "sourceUrl" | "rawShareText" | "title" | "userNote">, category: Category, subCategory: string, savedIntent: SavedIntent, keywords: string[], entities: Array<{ type: string; value: string }>): string {
  return [
    input.sourceUrl,
    input.rawShareText,
    input.title,
    input.userNote,
    category,
    subCategory,
    savedIntent,
    keywords.join(" "),
    entities.map((entity) => `${entity.type}:${entity.value}`).join(" ")
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export interface ScannedTextMigrationReport {
  migratedCount: number;
  repairedTitleCount: number;
  failedCount: number;
  backupJson: string;
  state: AppState;
}

export interface ScannedTextMigrationV3Change {
  id: string;
  type: "SavedItem" | "ImportBatchItem";
  before: string;
  after: string;
  uncertain: boolean;
}

export interface ScannedTextMigrationV3Report {
  checkedCount: number;
  abnormalCount: number;
  savedItemCount: number;
  importBatchItemCount: number;
  changedCount: number;
  uncertainCount: number;
  backupJson: string;
  changes: ScannedTextMigrationV3Change[];
  state: AppState;
}

export function migrateScannedTextV2(state: AppState): ScannedTextMigrationReport {
  const backupJson = JSON.stringify(state, null, 2);
  let migratedCount = 0;
  let repairedTitleCount = 0;
  let failedCount = 0;
  const savedItems = state.savedItems.map((item) => {
    try {
      const rawTitle = item.rawTitle || item.title || item.rawShareText || "";
      const cleanedTitle = cleanScannedTitle(rawTitle, item.rawShareText);
      const title = cleanedTitle || normalizeStoredTitle(item.title, item.rawShareText);
      const repaired = title !== item.title || cleanedTitle !== item.cleanedTitle;
      if (repaired) repairedTitleCount += 1;
      migratedCount += 1;
      return {
        ...item,
        rawTitle,
        cleanedTitle: title,
        title,
        searchableText: buildSearchableText(
          { sourceUrl: item.sourceUrl, rawShareText: cleanScannedText(item.rawShareText), title, userNote: item.userNote },
          item.contentDomain,
          item.contentSubDomain,
          item.savedIntent,
          item.keywords,
          item.entities
        ),
        updatedAt: new Date().toISOString()
      };
    } catch {
      failedCount += 1;
      return item;
    }
  });

  return {
    migratedCount,
    repairedTitleCount,
    failedCount,
    backupJson,
    state: { ...state, savedItems, schemaVersion: APP_SCHEMA_VERSION }
  };
}

export function migrateScannedTextV3(state: AppState): ScannedTextMigrationV3Report {
  const backupJson = JSON.stringify(state, null, 2);
  const changes: ScannedTextMigrationV3Change[] = [];
  const now = new Date().toISOString();

  const savedItems = (state.savedItems ?? []).map((item) => {
    const before = item.displayTitle || item.cleanedTitle || item.title || item.rawTitle || "";
    const rawTitle = cleanScannedText(item.rawTitle || item.title || item.rawShareText || "");
    const cleanedTitle = cleanScannedTitle(item.cleanedTitle || rawTitle, item.rawShareText);
    const displayTitle = pickDisplayTitle({ userEditedTitle: item.userEditedTitle, cleanedTitle, rawTitle });
    const uncertain = isTextNormalizationUncertain(rawTitle, cleanedTitle, displayTitle);
    if (before !== displayTitle || item.textNormalizationVersion !== 3) {
      changes.push({ id: item.id, type: "SavedItem", before, after: displayTitle, uncertain });
    }
    const normalized = {
      ...item,
      rawTitle,
      cleanedTitle,
      displayTitle,
      title: displayTitle,
      rawShareText: cleanScannedText(item.rawShareText),
      searchableText: buildSearchableText(
        { sourceUrl: item.sourceUrl, rawShareText: cleanScannedText(item.rawShareText), title: displayTitle, userNote: item.userNote },
        item.contentDomain,
        item.contentSubDomain,
        item.savedIntent,
        item.keywords,
        item.entities
      ),
      textNormalizationVersion: 3,
      updatedAt: now
    };
    return normalized;
  });

  const importBatchItems = (state.importBatchItems ?? []).map((item) => {
    const before = item.displayTitle || item.cleanedTitle || item.title || item.rawTitle || "";
    const rawTitle = cleanScannedText(item.rawTitle || item.title || item.rawShareText || item.visibleText || "");
    const cleanedTitle = cleanScannedTitle(item.cleanedTitle || rawTitle, item.rawShareText || item.visibleText || "");
    const displayTitle = pickDisplayTitle({ userEditedTitle: item.userEditedTitle, cleanedTitle, rawTitle });
    const uncertain = isTextNormalizationUncertain(rawTitle, cleanedTitle, displayTitle);
    if (before !== displayTitle || item.textNormalizationVersion !== 3) {
      changes.push({ id: item.id, type: "ImportBatchItem", before, after: displayTitle, uncertain });
    }
    return {
      ...item,
      rawTitle,
      cleanedTitle,
      displayTitle,
      title: displayTitle,
      rawShareText: cleanScannedText(item.rawShareText),
      visibleText: item.visibleText ? cleanScannedText(item.visibleText) : item.visibleText,
      textNormalizationVersion: 3
    };
  });

  const savedItemById = new Map(savedItems.map((item) => [item.id, item]));
  const smartAlbums = (state.smartAlbums ?? []).map((album) => ({
    ...album,
    updatedAt: changes.length ? now : album.updatedAt,
    recommendedItemIds: album.recommendedItemIds.filter((id) => savedItemById.has(id)).slice(0, 3),
    suggestedItemIds: (album.suggestedItemIds ?? []).filter((id) => savedItemById.has(id)),
    savedItemIds: album.savedItemIds.filter((id) => savedItemById.has(id))
  }));

  const importBatches = (state.importBatches ?? []).map((batch) => {
    const batchItems = importBatchItems.filter((item) => item.batchId === batch.id);
    return {
      ...batch,
      scanSummary: {
        ...batch.scanSummary,
        totalFound: batch.scanSummary?.totalFound ?? batchItems.length,
        selectedCount: batch.scanSummary?.selectedCount ?? batchItems.filter((item) => item.status === "imported").length,
        missingTitleCount: batchItems.filter((item) => !item.displayTitle || item.displayTitle === "标题待补充").length,
        missingLinkCount: batchItems.filter((item) => !item.sourceUrl).length,
        duplicateCount: batch.duplicateCount,
        lastScannedAt: batch.updatedAt,
        sampleTitles: batchItems.map((item) => item.displayTitle || item.title).filter(Boolean).slice(0, 5)
      }
    };
  });

  const checkedCount = savedItems.length + importBatchItems.length;
  const uncertainCount = changes.filter((change) => change.uncertain).length;
  return {
    checkedCount,
    abnormalCount: changes.length,
    savedItemCount: savedItems.length,
    importBatchItemCount: importBatchItems.length,
    changedCount: changes.length,
    uncertainCount,
    backupJson,
    changes,
    state: {
      ...state,
      schemaVersion: APP_SCHEMA_VERSION,
      savedItems,
      importBatchItems,
      importBatches,
      smartAlbums
    }
  };
}

function cleanScannedTitle(title: string, rawShareText: string): string {
  const source = title || rawShareText;
  const withoutUrl = cleanScannedText(source).replace(/https?:\/\/\S+/g, " ");
  const bracket = withoutUrl.match(/[【\[]([^】\]]+)[】\]]/);
  const candidate = bracket?.[1] ?? withoutUrl.replace(/^\d+[\s.、-]*/, "");
  const cleaned = candidate
    .replace(/\s+[-—–]\s+[^|｜】]+(\s*[|｜]\s*小红书.*)?$/, "")
    .replace(/小红书\s*-\s*你的生活兴趣社区|你的生活兴趣社区/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateGraphemeSafe(cleaned, 80);
}

function cleanScannedText(value: string): string {
  const textarea = typeof document === "undefined" ? undefined : document.createElement("textarea");
  if (textarea) {
    textarea.innerHTML = value;
  }
  const decoded = textarea?.value ?? value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"");
  return decoded
    .normalize("NFC")
    .replace(/[\uFEFF\u00AD]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateGraphemeSafe(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const intlWithSegmenter = Intl as typeof Intl & {
    Segmenter?: new (locale: string, options: { granularity: "grapheme" }) => {
      segment(value: string): Iterable<{ segment: string }>;
    };
  };
  const segmenter = typeof Intl !== "undefined" && intlWithSegmenter.Segmenter
    ? new intlWithSegmenter.Segmenter("zh-CN", { granularity: "grapheme" })
    : undefined;
  if (!segmenter) return Array.from(value).slice(0, maxLength).join("");
  let output = "";
  for (const segment of segmenter.segment(value)) {
    if ((output + segment.segment).length > maxLength) break;
    output += segment.segment;
  }
  return output;
}

function isTextNormalizationUncertain(rawTitle: string, cleanedTitle: string, displayTitle: string): boolean {
  if (!displayTitle || displayTitle === "标题待补充") return true;
  if (/[\uFFFD]|锛|銆|鐨|鍏|馃|瑙|鏀|涔/.test(rawTitle + cleanedTitle)) return true;
  if (rawTitle.length > 120 && cleanedTitle.length < 4) return true;
  return false;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
function normalizeContentText(title: string, rawShareText: string): string {
  return `${title} ${rawShareText}`
    .normalize("NFC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/复制这段文字(?:后)?[，,。；;\s]*/g, " ")
    .replace(/打开[【\[]?小红书[】\]]?(?:查看?|看)?(?:笔记)?/g, " ")
    .replace(/去?小红书(?:查看?|看)?(?:笔记)?/g, " ")
    .replace(/(?:分享自|来自)小红书/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 480);
}
export const NORMALIZATION_VERSION = 4;

export interface SourceUrlAnalysis {
  rawUrl: string;
  canonicalSourceUrl: string;
  sourceId?: string;
  status: "valid" | "partial" | "invalid" | "missing" | "unavailable" | "unchecked";
  warnings: string[];
}

export interface NormalizedSavedContent {
  normalizedTitle: string;
  normalizedContent: string;
  normalizationVersion: number;
  normalizationWarnings: string[];
}

export interface DataQualityDiagnostic {
  totalCount: number;
  withSourceIdCount: number;
  withValidSourceUrlCount: number;
  normalizedContentCount: number;
  emptyTitleCount: number;
  emptyRawTextCount: number;
  duplicateCandidateCount: number;
  unparseableLinkCount: number;
  userCorrectedLinkCount: number;
  normalizationWarningCount: number;
  errors: Array<{ deidentifiedId: string; types: string[] }>;
}

const SOURCE_ID_PATTERN = /^[a-zA-Z0-9_-]{6,80}$/;
const INVALID_SOURCE_IDS = new Set(["explore", "discovery", "item", "profile", "user", "home", "search", "note", "notes", "collect"]);
const TRACKING_QUERY_KEYS = new Set(["source", "xhsshare", "share_from_user_hidden", "appuid", "apptime", "share_id", "share_channel"]);

export function analyzeSourceUrl(value: string): SourceUrlAnalysis {
  const rawUrl = String(value || "").trim();
  if (!rawUrl) return { rawUrl, canonicalSourceUrl: "", status: "missing", warnings: ["source_url_missing"] };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { rawUrl, canonicalSourceUrl: "", status: "invalid", warnings: ["source_url_unparseable"] };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { rawUrl, canonicalSourceUrl: "", status: "invalid", warnings: ["source_url_protocol_invalid"] };
  }
  url.hash = "";
  const isXhs = /(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$/i.test(url.hostname);
  if (!isXhs) return { rawUrl, canonicalSourceUrl: url.toString(), status: "partial", warnings: ["source_platform_not_xiaohongshu"] };
  if (/\/user\/profile(?:\/|$)/i.test(url.pathname) && !/\/user\/profile\/[a-zA-Z0-9_-]{6,80}\/[a-zA-Z0-9_-]{6,80}(?:\/|$)/i.test(url.pathname)) {
    return { rawUrl, canonicalSourceUrl: "", status: "invalid", warnings: ["profile_url_is_not_note"] };
  }
  const sourceId = extractSourceId(rawUrl);
  if (/xhslink\.com$/i.test(url.hostname) && !sourceId) {
    return { rawUrl, canonicalSourceUrl: url.toString(), status: "partial", warnings: ["short_link_requires_live_resolution"] };
  }
  if (!sourceId) return { rawUrl, canonicalSourceUrl: url.toString(), status: "partial", warnings: ["source_id_missing"] };
  const canonical = new URL(`https://www.xiaohongshu.com/explore/${encodeURIComponent(sourceId)}`);
  for (const key of ["xsec_token", "xsec_source"]) {
    const token = url.searchParams.get(key);
    if (token) canonical.searchParams.set(key, token);
  }
  return { rawUrl, canonicalSourceUrl: canonical.toString(), sourceId, status: "valid", warnings: [] };
}

export function extractSourceId(value: string): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const profileOnly = /\/user\/profile\/[a-zA-Z0-9_-]{6,80}\/?$/i.test(url.pathname);
    if (profileOnly) return undefined;
    const pathMatch = url.pathname.match(/\/(?:explore|discovery\/item|search_result)\/([^/?#]+)/i);
    const nestedProfileNote = url.pathname.match(/\/user\/profile\/[a-zA-Z0-9_-]{6,80}\/([a-zA-Z0-9_-]{6,80})(?:\/|$)/i);
    const queryCandidate = /\/(?:explore|discovery\/item|search_result|note)(?:\/|$)/i.test(url.pathname)
      ? url.searchParams.get("note_id") || url.searchParams.get("noteId") || url.searchParams.get("item_id")
      : undefined;
    const candidate = decodeURIComponent(pathMatch?.[1] || nestedProfileNote?.[1] || queryCandidate || "").trim();
    return isValidSourceId(candidate) ? candidate : undefined;
  } catch {
    return isValidSourceId(raw) ? raw : undefined;
  }
}

export function isValidSourceId(value: string | undefined): value is string {
  return Boolean(value && SOURCE_ID_PATTERN.test(value) && !INVALID_SOURCE_IDS.has(value.toLowerCase()));
}

export function getPreferredSourceUrl(item: Pick<SavedItem, "sourceUrl"> & Partial<Pick<SavedItem, "canonicalSourceUrl" | "userCorrectedSourceUrl">>): string {
  const corrected = analyzeSourceUrl(item.userCorrectedSourceUrl || "");
  if (corrected.status === "valid" || corrected.status === "partial") return item.userCorrectedSourceUrl!.trim();
  const raw = analyzeSourceUrl(item.sourceUrl);
  if (raw.status === "valid" || raw.status === "partial") return item.sourceUrl.trim();
  const canonical = analyzeSourceUrl(item.canonicalSourceUrl || "");
  return canonical.status === "valid" || canonical.status === "partial" ? item.canonicalSourceUrl!.trim() : "";
}

export function normalizeSavedContent(rawTitle: string, rawText: string, author?: string): NormalizedSavedContent {
  const warnings: string[] = [];
  const title = normalizeQualityText(rawTitle)
    .replace(/^\d+\s*[【[]/, "【")
    .replace(/\s*[-—|]\s*小红书.*$/i, "")
    .trim();
  const authorText = normalizeQualityText(author || "");
  let content = normalizeQualityText(rawText)
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/复制这段文字(?:后)?[，,。；;\s]*/g, " ")
    .replace(/(?:然后)?打开[【[]?小红书[】\]]?(?:查看?|看)?(?:笔记)?/g, " ")
    .replace(/(?:分享自|来自)小红书/g, " ")
    .replace(/(?:点赞|收藏|评论|分享)\s*(?:\d+(?:\.\d+)?[wW万]?)?/g, " ")
    .replace(/(?:^|\s)#(?:小红书|热门|推荐|笔记)(?=\s|$)/gi, " ")
    .replace(/(?:^|\s)\d+(?:\.\d+)?[wW万]?(?=\s|$)/g, " ");
  if (title) content = removeRepeatedQualitySegment(content, title);
  if (authorText) content = removeRepeatedQualitySegment(content, authorText);
  content = normalizeQualityText(content);
  if (!rawText.trim()) warnings.push("raw_text_empty");
  if (!title) warnings.push("normalized_title_empty");
  if (!content) {
    warnings.push("normalized_content_empty_fallback_raw");
    content = normalizeQualityText(rawText).slice(0, 2000);
  }
  return {
    normalizedTitle: title || normalizeQualityText(rawTitle).slice(0, 120),
    normalizedContent: content.slice(0, 2000),
    normalizationVersion: NORMALIZATION_VERSION,
    normalizationWarnings: [...new Set(warnings)]
  };
}

export function buildStableDedupeKey(input: Partial<Pick<SavedItem, "sourceId" | "canonicalSourceUrl" | "sourceUrl" | "rawTitle" | "title" | "rawText" | "rawShareText" | "normalizedContent" | "author">>): string {
  const sourceId = input.sourceId || extractSourceId(input.canonicalSourceUrl || input.sourceUrl || "");
  if (sourceId) return `source-id:${sourceId.toLowerCase()}`;
  const analysis = analyzeSourceUrl(input.canonicalSourceUrl || input.sourceUrl || "");
  if (analysis.canonicalSourceUrl && analysis.status !== "invalid" && analysis.status !== "missing") return `source-url:${analysis.canonicalSourceUrl.toLowerCase()}`;
  const title = normalizeQualityText(input.rawTitle || input.title || "").toLowerCase();
  const author = normalizeQualityText(input.author || "").toLowerCase();
  const excerpt = normalizeQualityText(input.normalizedContent || input.rawText || input.rawShareText || "").toLowerCase().slice(0, 160);
  if (!title || (!author && excerpt.length < 8)) return "";
  return `fallback:${stableHash(`${title}|${author}|${excerpt}`)}`;
}

export function diagnoseSavedItems(items: SavedItem[]): DataQualityDiagnostic {
  const keyCounts = new Map<string, number>();
  const errors: DataQualityDiagnostic["errors"] = [];
  let duplicateCandidateCount = 0;
  for (const item of items) {
    const key = buildStableDedupeKey(item);
    if (key) {
      const count = (keyCounts.get(key) || 0) + 1;
      keyCounts.set(key, count);
      if (count > 1) duplicateCandidateCount += 1;
    }
    const types: string[] = [];
    const analysis = analyzeSourceUrl(getPreferredSourceUrl(item) || item.sourceUrl);
    if (!item.sourceId && !analysis.sourceId) types.push("SOURCE_ID_MISSING");
    if (analysis.status === "invalid" || analysis.status === "missing") types.push("SOURCE_URL_INVALID");
    if (!(item.normalizedContent || item.normalizedContentText || "").trim()) types.push("NORMALIZED_CONTENT_EMPTY");
    if (!(item.rawTitle || item.title || "").trim()) types.push("TITLE_EMPTY");
    if (!(item.rawText || item.rawShareText || "").trim()) types.push("RAW_TEXT_EMPTY");
    if ((item.normalizationWarnings || []).length > 0) types.push("NORMALIZATION_WARNING");
    if (types.length) errors.push({ deidentifiedId: stableHash(item.id).slice(0, 12), types });
  }
  return {
    totalCount: items.length,
    withSourceIdCount: items.filter((item) => Boolean(item.sourceId || extractSourceId(item.sourceUrl))).length,
    withValidSourceUrlCount: items.filter((item) => analyzeSourceUrl(getPreferredSourceUrl(item) || item.sourceUrl).status === "valid").length,
    normalizedContentCount: items.filter((item) => Boolean((item.normalizedContent || item.normalizedContentText || "").trim())).length,
    emptyTitleCount: items.filter((item) => !(item.rawTitle || item.title || "").trim()).length,
    emptyRawTextCount: items.filter((item) => !(item.rawText || item.rawShareText || "").trim()).length,
    duplicateCandidateCount,
    unparseableLinkCount: items.filter((item) => ["invalid", "missing"].includes(analyzeSourceUrl(getPreferredSourceUrl(item) || item.sourceUrl).status)).length,
    userCorrectedLinkCount: items.filter((item) => Boolean(item.userCorrectedSourceUrl)).length,
    normalizationWarningCount: items.reduce((total, item) => total + (item.normalizationWarnings || []).length, 0),
    errors
  };
}

export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizeQualityText(value: string): string {
  return String(value || "").normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\uFEFF\u00AD]/g, "").replace(/\s+/g, " ").trim();
}

function removeRepeatedQualitySegment(content: string, segment: string): string {
  const normalizedSegment = normalizeQualityText(segment);
  if (!normalizedSegment) return content;
  return normalizeQualityText(content).replace(new RegExp(escapeQualityRegExp(normalizedSegment), "gi"), " ");
}

function escapeQualityRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
