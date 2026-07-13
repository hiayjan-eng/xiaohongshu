import { CATEGORIES } from "@revival/shared-types";
import type { ActionCardDraft, AiClassificationResult, Category, EntityTag, SavedItem, ShareInput, SmartAlbum, SmartAlbumPriority, TaskDraft } from "@revival/shared-types";

export type AiTask = "classify_action_card" | "generate_smart_albums" | "regenerate_action_card" | "summarize_import_batch" | "generate_search_keywords";
export type AiFallbackReason = "AI_KEY_MISSING" | "AI_TIMEOUT" | "AI_BAD_JSON" | "AI_API_ERROR" | "AI_PROXY_UNAVAILABLE" | "AI_UNSUPPORTED_TASK" | "AI_PAYLOAD_TOO_LARGE";

export interface AiResponseMeta {
  provider: "mock" | "real";
  providerName: string;
  model: string;
  fallback: boolean;
  reason?: AiFallbackReason | string;
  apiKeyConfigured: boolean;
}

export interface AiProxySuccess<T = unknown> {
  ok: true;
  data: T;
  meta: AiResponseMeta;
}

export interface AiProxyError {
  ok: false;
  error: { code: AiFallbackReason | "AI_BAD_REQUEST" | "AI_METHOD_NOT_ALLOWED" | "AI_INTERNAL_ERROR"; message: string };
  meta?: Partial<AiResponseMeta>;
}

export type AiProxyResponse<T = unknown> = AiProxySuccess<T> | AiProxyError;

const legacyCategoryAliases: Record<string, { category: Category; subCategory: string }> = {
  小红书运营: { category: "内容创作", subCategory: "小红书运营" },
  灵感素材: { category: "内容创作", subCategory: "灵感素材" },
  AI工具: { category: "AI 与效率", subCategory: "AI 工具" },
  工作效率: { category: "AI 与效率", subCategory: "效率工作流" },
  职场学习: { category: "AI 与效率", subCategory: "职场学习" },
  旅行地点: { category: "出行与探店", subCategory: "旅行路线" },
  美食探店: { category: "出行与探店", subCategory: "美食探店" },
  生活方式: { category: "出行与探店", subCategory: "周末生活" },
  菜谱做饭: { category: "饮食与健康", subCategory: "菜谱做饭" },
  健身运动: { category: "饮食与健康", subCategory: "健身运动" },
  家居生活: { category: "生活与家居", subCategory: "家居生活" },
  穿搭变美: { category: "穿搭与消费", subCategory: "穿搭变美" },
  购物参考: { category: "穿搭与消费", subCategory: "购物参考" },
  情绪成长: { category: "情绪与关系", subCategory: "情绪成长" },
  亲密关系: { category: "情绪与关系", subCategory: "亲密关系" },
  读书学习: { category: "读书与思考", subCategory: "读书学习" },
  其他: { category: "暂存", subCategory: "待补充备注" }
};

export function isAiTask(value: unknown): value is AiTask {
  return value === "classify_action_card" || value === "generate_smart_albums" || value === "regenerate_action_card" || value === "summarize_import_batch" || value === "generate_search_keywords";
}

export function extractJsonFromText(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  for (const candidate of [cleaned, sliceJson(cleaned, "{", "}"), sliceJson(cleaned, "[", "]")].filter(Boolean)) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  return undefined;
}

export function normalizeClassificationResult(value: unknown, input: ShareInput, fallback: AiClassificationResult): AiClassificationResult {
  const raw = unwrapData(value);
  if (!isRecord(raw)) return fallback;
  const alias = normalizeCategory(raw.category, fallback.category, fallback.subCategory);
  const rawActionCard = isRecord(raw.actionCard) ? raw.actionCard : raw;
  const actionCard = normalizeActionCardDraft(rawActionCard, fallback.actionCard);
  const confidence = readConfidence(raw.confidence, fallback.confidence);
  const intent = readString(raw.intent, fallback.intent);
  const whyThisCategory = readString(raw.whyThisCategory, fallback.whyThisCategory);
  const summary = readString(raw.summary, fallback.summary);
  const keywords = readStringArray(raw.keywords, fallback.keywords, 12);
  const entities = readEntities(raw.entities, fallback.entities);
  const searchableText = readString(raw.searchableText, fallback.searchableText);
  return {
    category: alias.category,
    subCategory: readString(raw.subCategory, alias.subCategory),
    confidence,
    intent,
    whyThisCategory,
    summary,
    keywords,
    entities,
    searchableText: searchableText || buildSearchableText(input, alias.category, alias.subCategory, intent, whyThisCategory, summary, keywords, entities, actionCard),
    actionCard
  };
}

export function normalizeActionCardDraft(value: unknown, fallback: ActionCardDraft): ActionCardDraft {
  const raw = isRecord(value) ? value : {};
  const openOriginalFocus = readStringArray(raw.openOriginalFocus ?? raw.focus, fallback.openOriginalFocus, 6);
  const output = readString(raw.output, fallback.output);
  const doneCriteria = readString(raw.doneCriteria, fallback.doneCriteria);
  const avoidDoing = readString(raw.avoidDoing, fallback.avoidDoing);
  const ifInfoMissing = readString(raw.ifInfoMissing, fallback.ifInfoMissing);
  const followUp = readString(raw.followUp, fallback.followUp);
  return {
    title: cleanCardTitle(readString(raw.title, fallback.title)),
    goal: readString(raw.goal, fallback.goal),
    whySaved: readString(raw.whySaved, fallback.whySaved),
    nextAction: readString(raw.nextAction, fallback.nextAction),
    openOriginalFocus,
    output,
    estimatedTime: normalizeEstimatedTime(readString(raw.estimatedTime, fallback.estimatedTime)),
    difficulty: readDifficulty(raw.difficulty, fallback.difficulty),
    doneCriteria,
    avoidDoing,
    ifInfoMissing,
    followUp,
    tasks: readTasks(raw.tasks, fallback.tasks),
    structuredFields: readStructuredFields(raw.structuredFields ?? raw.fields, { ...fallback.structuredFields, 打开原帖后重点看什么: openOriginalFocus, 产出物: output, 完成标准: doneCriteria, 避免: avoidDoing })
  };
}

export function normalizeSmartAlbumsResult(value: unknown, savedItems: SavedItem[], fallback: SmartAlbum[], now = new Date()): SmartAlbum[] {
  const raw = unwrapData(value);
  const rawAlbums = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.albums) ? raw.albums : [];
  if (rawAlbums.length === 0) return fallback;
  const savedItemById = new Map(savedItems.map((item) => [item.id, item]));
  const validIds = new Set(savedItemById.keys());
  const createdAt = now.toISOString();
  const albums = rawAlbums.filter(isRecord).map((album, index): SmartAlbum | undefined => {
    const ids = readStringArray(album.savedItemIds, [], 80).filter((id) => validIds.has(id));
    const safeIds = ids.length > 0 ? ids : pickFallbackItemIds(savedItems, album.category);
    if (safeIds.length === 0) return undefined;
    const primaryItem = savedItemById.get(safeIds[0]);
    const alias = normalizeCategory(album.category, primaryItem?.category ?? fallback[0]?.category ?? "暂存", primaryItem?.subCategory ?? "主题整理");
    const keywords = readStringArray(album.keywords, collectKeywords(safeIds, savedItemById), 8);
    const title = readString(album.title, keywords[0] ? `${keywords[0]}：先复活 3 条` : `智能专辑 ${index + 1}`);
    const priorityScore = readNumber(album.priorityScore, safeIds.length * 10 + keywords.length);
    return {
      id: readString(album.id, `album_ai_${index + 1}_${slugify(title)}`),
      title,
      description: readString(album.description, `从 ${safeIds.length} 条收藏里整理出的行动主题。`),
      category: alias.category,
      albumType: readString(album.albumType, "theme"),
      keywords,
      savedItemIds: safeIds,
      recommendedItemIds: readStringArray(album.recommendedItemIds, safeIds.slice(0, 3), 3).filter((id) => validIds.has(id)),
      coverItemId: readString(album.coverItemId, safeIds[0]),
      whyThisAlbum: readString(album.whyThisAlbum, "这些收藏指向同一个使用场景，适合先合并成一个行动主题。"),
      whyStartHere: readString(album.whyStartHere, "先从信息最完整、最近保存的 3 条开始。"),
      suggestedFirstAction: readString(album.suggestedFirstAction, "先打开推荐的第一条，完成一个 5-30 分钟的小动作。"),
      priority: readPriority(album.priority, priorityScore),
      priorityScore,
      status: album.status === "confirmed" || album.status === "archived" ? album.status : "candidate",
      createdAt,
      updatedAt: createdAt
    };
  }).filter((album): album is SmartAlbum => Boolean(album));
  return albums.length > 0 ? albums.slice(0, 12) : fallback;
}

export function normalizeKeywordsResult(value: unknown, fallback: string[]): string[] {
  const raw = unwrapData(value);
  if (Array.isArray(raw)) return readStringArray(raw, fallback, 12);
  if (isRecord(raw)) return readStringArray(raw.keywords, fallback, 12);
  return fallback;
}

function unwrapData(value: unknown): unknown {
  const parsed = extractJsonFromText(value);
  if (isRecord(parsed) && "data" in parsed) return parsed.data;
  return parsed;
}

function normalizeCategory(value: unknown, fallbackCategory: Category, fallbackSubCategory: string): { category: Category; subCategory: string } {
  if (typeof value === "string" && (CATEGORIES as readonly string[]).includes(value)) return { category: value as Category, subCategory: fallbackSubCategory };
  if (typeof value === "string" && legacyCategoryAliases[value]) return legacyCategoryAliases[value];
  return { category: fallbackCategory, subCategory: fallbackSubCategory };
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(value: unknown, fallback: string[], limit: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return values.length > 0 ? unique(values).slice(0, limit) : fallback;
}

function readEntities(value: unknown, fallback: EntityTag[]): EntityTag[] {
  if (!Array.isArray(value)) return fallback;
  const entities = value.filter(isRecord).map((item) => ({ type: readString(item.type, "topic"), value: readString(item.value, "") })).filter((item) => item.value);
  return entities.length > 0 ? entities.slice(0, 12) : fallback;
}

function readTasks(value: unknown, fallback: TaskDraft[]): TaskDraft[] {
  if (!Array.isArray(value)) return fallback;
  const tasks = value.filter(isRecord).map((item) => ({ title: readString(item.title, "下一步"), description: readString(item.description, "完成一个具体的小动作。"), estimatedTime: normalizeEstimatedTime(readString(item.estimatedTime, "20分钟")), dueDate: typeof item.dueDate === "string" ? item.dueDate : undefined }));
  return tasks.length > 0 ? tasks.slice(0, 3) : fallback;
}

function readStructuredFields(value: unknown, fallback: Record<string, string | string[]>): Record<string, string | string[]> {
  if (!isRecord(value)) return fallback;
  const fields: Record<string, string | string[]> = {};
  Object.entries(value).forEach(([key, fieldValue]) => {
    if (typeof fieldValue === "string") fields[key] = fieldValue;
    if (Array.isArray(fieldValue)) fields[key] = fieldValue.filter((item): item is string => typeof item === "string");
  });
  return Object.keys(fields).length > 0 ? fields : fallback;
}

function readConfidence(value: unknown, fallback: AiClassificationResult["confidence"]): AiClassificationResult["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}

function readDifficulty(value: unknown, fallback: ActionCardDraft["difficulty"]): ActionCardDraft["difficulty"] {
  return value === "低" || value === "中" || value === "高" ? value : fallback;
}

function readPriority(value: unknown, score: number): SmartAlbumPriority {
  if (value === "high" || value === "medium" || value === "low") return value;
  return score >= 36 ? "high" : score >= 18 ? "medium" : "low";
}

function normalizeEstimatedTime(value: string): string {
  return value.trim() || "20分钟";
}

function cleanCardTitle(value: string): string {
  return value.replace(/行动卡行动卡/g, "行动卡").replace(/其他行动卡/g, "补全信息卡").replace(/卡卡/g, "卡");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function sliceJson(value: string, startToken: "{" | "[", endToken: "}" | "]"): string {
  const start = value.indexOf(startToken);
  const end = value.lastIndexOf(endToken);
  return start >= 0 && end > start ? value.slice(start, end + 1) : "";
}

function pickFallbackItemIds(savedItems: SavedItem[], rawCategory: unknown): string[] {
  const alias = normalizeCategory(rawCategory, savedItems[0]?.category ?? "暂存", savedItems[0]?.subCategory ?? "主题整理");
  const categoryItems = savedItems.filter((item) => item.category === alias.category);
  return (categoryItems.length > 0 ? categoryItems : savedItems).slice(0, 8).map((item) => item.id);
}

function collectKeywords(ids: string[], items: Map<string, SavedItem>): string[] {
  return unique(ids.flatMap((id) => {
    const item = items.get(id);
    return item ? [item.subCategory, ...item.keywords, ...item.entities.map((entity) => entity.value)] : [];
  }).filter(Boolean)).slice(0, 8);
}

function buildSearchableText(input: ShareInput, category: Category, subCategory: string, intent: string, whyThisCategory: string, summary: string, keywords: string[], entities: EntityTag[], actionCard: ActionCardDraft): string {
  const fieldText = Object.entries(actionCard.structuredFields).flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : value]).join(" ");
  const taskText = actionCard.tasks.map((task) => `${task.title} ${task.description}`).join(" ");
  const entityText = entities.map((entity) => `${entity.type}:${entity.value}`).join(" ");
  return [input.sourceUrl, input.rawShareText, input.title, input.userNote, category, subCategory, intent, whyThisCategory, summary, keywords.join(" "), entityText, actionCard.title, actionCard.goal, actionCard.whySaved, actionCard.nextAction, actionCard.openOriginalFocus.join(" "), actionCard.output, actionCard.doneCriteria, actionCard.avoidDoing, actionCard.ifInfoMissing, actionCard.followUp, fieldText, taskText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "").slice(0, 32).toLowerCase() || "untitled";
}