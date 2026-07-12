import { CATEGORIES } from "@revival/shared-types";
import type {
  ActionCardDraft,
  AiClassificationResult,
  Category,
  EntityTag,
  SavedItem,
  ShareInput,
  SmartAlbum,
  TaskDraft
} from "@revival/shared-types";

export type AiTask =
  | "classify_action_card"
  | "generate_smart_albums"
  | "regenerate_action_card"
  | "summarize_import_batch"
  | "generate_search_keywords";

export type AiFallbackReason =
  | "AI_KEY_MISSING"
  | "AI_TIMEOUT"
  | "AI_BAD_JSON"
  | "AI_API_ERROR"
  | "AI_PROXY_UNAVAILABLE"
  | "AI_UNSUPPORTED_TASK"
  | "AI_PAYLOAD_TOO_LARGE";

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
  error: {
    code: AiFallbackReason | "AI_BAD_REQUEST" | "AI_METHOD_NOT_ALLOWED" | "AI_INTERNAL_ERROR";
    message: string;
  };
  meta?: Partial<AiResponseMeta>;
}

export type AiProxyResponse<T = unknown> = AiProxySuccess<T> | AiProxyError;

export function isAiTask(value: unknown): value is AiTask {
  return (
    value === "classify_action_card" ||
    value === "generate_smart_albums" ||
    value === "regenerate_action_card" ||
    value === "summarize_import_batch" ||
    value === "generate_search_keywords"
  );
}

export function extractJsonFromText(value: unknown): unknown {
  if (typeof value !== "string") return value;

  const cleaned = value
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  const candidates = [cleaned, sliceJson(cleaned, "{", "}"), sliceJson(cleaned, "[", "]")].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next possible JSON slice.
    }
  }

  return undefined;
}

export function normalizeClassificationResult(
  value: unknown,
  input: ShareInput,
  fallback: AiClassificationResult
): AiClassificationResult {
  const raw = unwrapData(value);
  if (!isRecord(raw)) return fallback;

  const rawActionCard = isRecord(raw.actionCard) ? raw.actionCard : {};
  const actionCard = normalizeActionCardDraft(rawActionCard, fallback.actionCard);
  const category = isCategory(raw.category) ? raw.category : fallback.category;
  const confidence = readConfidence(raw.confidence, fallback.confidence);
  const intent = readString(raw.intent, fallback.intent);
  const summary = readString(raw.summary, fallback.summary);
  const keywords = readStringArray(raw.keywords, fallback.keywords, 12);
  const entities = readEntities(raw.entities, fallback.entities);
  const searchableText = readString(raw.searchableText, fallback.searchableText);

  return {
    category,
    confidence,
    intent,
    summary,
    keywords,
    entities,
    searchableText: searchableText || buildSearchableText(input, category, intent, summary, keywords, entities, actionCard),
    actionCard
  };
}

export function normalizeActionCardDraft(value: unknown, fallback: ActionCardDraft): ActionCardDraft {
  const raw = isRecord(value) ? value : {};
  return {
    title: readString(raw.title, fallback.title),
    goal: readString(raw.goal, fallback.goal),
    nextAction: readString(raw.nextAction, fallback.nextAction),
    estimatedTime: normalizeEstimatedTime(readString(raw.estimatedTime, fallback.estimatedTime)),
    difficulty: readString(raw.difficulty, fallback.difficulty) as ActionCardDraft["difficulty"],
    tasks: readTasks(raw.tasks, fallback.tasks),
    structuredFields: readStructuredFields(raw.structuredFields, fallback.structuredFields)
  };
}

export function normalizeSmartAlbumsResult(
  value: unknown,
  savedItems: SavedItem[],
  fallback: SmartAlbum[],
  now = new Date()
): SmartAlbum[] {
  const raw = unwrapData(value);
  const rawAlbums = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.albums) ? raw.albums : [];
  if (rawAlbums.length === 0) return fallback;

  const savedItemById = new Map(savedItems.map((item) => [item.id, item]));
  const validIds = new Set(savedItemById.keys());
  const createdAt = now.toISOString();

  const albums = rawAlbums
    .filter(isRecord)
    .map((album, index): SmartAlbum | undefined => {
      const rawIds = readStringArray(album.savedItemIds, [], 80).filter((id) => validIds.has(id));
      const ids = rawIds.length > 0 ? rawIds : pickFallbackItemIds(savedItems, album.category);
      if (ids.length === 0) return undefined;

      const primaryItem = savedItemById.get(ids[0]);
      const category = isCategory(album.category) ? album.category : primaryItem?.category ?? fallback[0]?.category ?? CATEGORIES[CATEGORIES.length - 1];
      const keywords = readStringArray(album.keywords, collectKeywords(ids, savedItemById), 8);
      const title = readString(album.title, keywords[0] ? `${keywords[0]} collection` : `Smart album ${index + 1}`);
      const description = readString(album.description, "A private smart album generated from confirmed saved items.");
      const priority = typeof album.priority === "number" && Number.isFinite(album.priority) ? album.priority : ids.length * 10 + keywords.length;

      return {
        id: readString(album.id, `album_ai_${index + 1}_${slugify(title)}`),
        title,
        description,
        category,
        keywords,
        savedItemIds: ids,
        coverItemId: readString(album.coverItemId, ids[0]),
        priority,
        status: album.status === "confirmed" || album.status === "archived" ? album.status : "candidate",
        createdAt,
        updatedAt: createdAt
      } satisfies SmartAlbum;
    })
    .filter((album): album is SmartAlbum => Boolean(album));

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

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown, fallback: string[], limit: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
  return values.length > 0 ? unique(values).slice(0, limit) : fallback;
}

function readEntities(value: unknown, fallback: EntityTag[]): EntityTag[] {
  if (!Array.isArray(value)) return fallback;
  const entities = value
    .filter(isRecord)
    .map((item) => ({
      type: readString(item.type, "topic"),
      value: readString(item.value, "")
    }))
    .filter((item) => item.value);
  return entities.length > 0 ? entities.slice(0, 12) : fallback;
}

function readTasks(value: unknown, fallback: TaskDraft[]): TaskDraft[] {
  if (!Array.isArray(value)) return fallback;
  const tasks = value
    .filter(isRecord)
    .map((item) => ({
      title: readString(item.title, "Next small action"),
      description: readString(item.description, "Start with one private, concrete step."),
      estimatedTime: normalizeEstimatedTime(readString(item.estimatedTime, "20 minutes")),
      dueDate: typeof item.dueDate === "string" ? item.dueDate : undefined
    }));
  return tasks.length > 0 ? tasks.slice(0, 8) : fallback;
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

function normalizeEstimatedTime(value: string): string {
  return value.trim() || "20 minutes";
}


function readConfidence(value: unknown, fallback: AiClassificationResult["confidence"]): AiClassificationResult["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : fallback;
}
function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
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
  const categoryItems = isCategory(rawCategory) ? savedItems.filter((item) => item.category === rawCategory) : savedItems;
  return categoryItems.slice(0, 8).map((item) => item.id);
}

function collectKeywords(ids: string[], items: Map<string, SavedItem>): string[] {
  return unique(
    ids.flatMap((id) => {
      const item = items.get(id);
      return item ? [...item.keywords, ...item.entities.map((entity) => entity.value)] : [];
    })
  ).slice(0, 8);
}

function buildSearchableText(
  input: ShareInput,
  category: Category,
  intent: string,
  summary: string,
  keywords: string[],
  entities: EntityTag[],
  actionCard: ActionCardDraft
): string {
  const fieldText = Object.entries(actionCard.structuredFields)
    .flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : value])
    .join(" ");
  const taskText = actionCard.tasks.map((task) => `${task.title} ${task.description}`).join(" ");
  const entityText = entities.map((entity) => `${entity.type}:${entity.value}`).join(" ");

  return [
    input.sourceUrl,
    input.rawShareText,
    input.title,
    input.userNote,
    category,
    intent,
    summary,
    keywords.join(" "),
    entityText,
    actionCard.title,
    actionCard.goal,
    actionCard.nextAction,
    fieldText,
    taskText
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "").slice(0, 32).toLowerCase() || "untitled";
}
