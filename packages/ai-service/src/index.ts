import { CATEGORIES } from "@revival/shared-types";
import type {
  ActionCardDraft,
  AiClassificationResult,
  Category,
  ClassificationConfidence,
  ContentDomain,
  EntityTag,
  ImportBatch,
  ReviveIntent,
  SavedItem,
  SavedIntent,
  ShareInput,
  SmartAlbum,
  TaskDraft
} from "@revival/shared-types";
import {
  buildClassifyActionCardPrompt,
  buildImportBatchSummaryPrompt,
  buildRegenerateActionCardPrompt,
  buildSearchKeywordsPrompt,
  buildSmartAlbumsPrompt,
  COLLECTION_REVIVAL_SYSTEM_PROMPT
} from "./prompts";
import {
  extractJsonFromText,
  normalizeActionCardDraft,
  normalizeClassificationResult,
  normalizeKeywordsResult,
  normalizeSmartAlbumsResult,
  type AiFallbackReason,
  type AiProxyResponse,
  type AiResponseMeta,
  type AiTask
} from "./schemas";
export type { AiFallbackReason, AiProxyError, AiProxyResponse, AiProxySuccess, AiResponseMeta, AiTask } from "./schemas";

export type AiProviderMode = "mock" | "openai-compatible" | "real";
export type AiCallStatus = "idle" | "success" | "fallback" | "blocked";
export type MaybePromise<T> = T | Promise<T>;

export interface AiProviderConfig {
  provider?: AiProviderMode;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

export interface AiRuntimeStatus {
  mode: "mock" | "real";
  providerName: string;
  modelName: string;
  apiKeyConfigured: boolean;
  lastCallStatus: AiCallStatus;
  fallbackActive: boolean;
  lastError?: string;
}

export interface RegenerateActionCardOptions {
  savedItem?: SavedItem;
  title?: string;
  rawShareText?: string;
  userNote?: string;
}

export interface ImportBatchSummary {
  title: string;
  summary: string;
  recommendedNextStep: string;
  fallbackUsed?: boolean;
}

export interface GenerateSmartAlbumsInput {
  savedItems: SavedItem[];
  existingAlbums?: SmartAlbum[];
  now?: Date;
}

export interface MockAiProviderOptions {
  generateSmartAlbums?: (savedItems: SavedItem[], now?: Date) => SmartAlbum[];
}

export interface AiProvider {
  readonly name: string;
  getStatus(): AiRuntimeStatus;
  classifyAndGenerateActionCard(input: ShareInput): MaybePromise<AiClassificationResult>;
  generateSmartAlbums(input: GenerateSmartAlbumsInput): MaybePromise<SmartAlbum[]>;
  regenerateActionCard(savedItemId: string, options?: RegenerateActionCardOptions): MaybePromise<ActionCardDraft>;
  summarizeImportBatch(batch: ImportBatch): MaybePromise<ImportBatchSummary>;
  generateSearchKeywords(input: ShareInput): MaybePromise<string[]>;
}

export class MockAiProvider implements AiProvider {
  readonly name = "mock";
  constructor(private readonly options: MockAiProviderOptions = {}) {}

  getStatus(): AiRuntimeStatus {
    return { mode: "mock", providerName: "MockAIProvider", modelName: "local-rules", apiKeyConfigured: false, lastCallStatus: "success", fallbackActive: false };
  }

  classifyAndGenerateActionCard(input: ShareInput): AiClassificationResult {
    return classifyAndGenerateActionCard(input);
  }

  generateSmartAlbums(input: GenerateSmartAlbumsInput): SmartAlbum[] {
    return this.options.generateSmartAlbums?.(input.savedItems, input.now) ?? [];
  }

  regenerateActionCard(_savedItemId: string, options: RegenerateActionCardOptions = {}): ActionCardDraft {
    const source = options.savedItem;
    return classifyAndGenerateActionCard({
      sourceUrl: source?.sourceUrl ?? "",
      title: options.title ?? source?.title ?? "",
      rawShareText: options.rawShareText ?? source?.rawShareText ?? "",
      userNote: options.userNote ?? source?.userNote ?? ""
    }).actionCard;
  }

  summarizeImportBatch(batch: ImportBatch): ImportBatchSummary {
    return {
      title: batch.title,
      summary: `已处理 ${batch.importedCount}/${batch.rawCount} 条收藏，其中 ${batch.duplicateCount} 条重复、${batch.failedCount} 条失败。`,
      recommendedNextStep: batch.importedCount > 0 ? "打开智能专辑，先挑 3 条最值得复活的内容。" : "先补充一条标题或备注更清楚的收藏。",
      fallbackUsed: true
    };
  }

  generateSearchKeywords(input: ShareInput): string[] {
    return classifyAndGenerateActionCard(input).keywords;
  }
}

export class OpenAICompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  private lastStatus: AiRuntimeStatus;
  private readonly fallback: AiProvider;

  constructor(private readonly config: AiProviderConfig, fallback: AiProvider = new MockAiProvider()) {
    this.fallback = fallback;
    this.lastStatus = getAiRuntimeStatus(config, "idle");
  }

  getStatus(): AiRuntimeStatus {
    return this.lastStatus;
  }

  async classifyAndGenerateActionCard(input: ShareInput): Promise<AiClassificationResult> {
    const fallback = classifyAndGenerateActionCard(input);
    if (!this.config.apiKey) return this.fallbackClassification(input, "AI API key is not configured", "blocked");
    try {
      const raw = await this.requestJson([{ role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT }, { role: "user", content: buildClassifyActionCardPrompt(input) }]);
      const result = normalizeClassificationResult(raw, input, fallback);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return result;
    } catch (error) {
      return this.fallbackClassification(input, error instanceof Error ? error.message : String(error), "fallback");
    }
  }

  async generateSmartAlbums(input: GenerateSmartAlbumsInput): Promise<SmartAlbum[]> {
    const fallback = await Promise.resolve(this.fallback.generateSmartAlbums(input));
    if (!this.config.apiKey) return this.withFallback(fallback, "AI API key is not configured", "blocked");
    try {
      const raw = await this.requestJson([{ role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT }, { role: "user", content: buildSmartAlbumsPrompt(input) }]);
      const albums = normalizeSmartAlbumsResult(raw, input.savedItems, fallback, input.now);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return albums;
    } catch (error) {
      return this.withFallback(fallback, error instanceof Error ? error.message : String(error), "fallback");
    }
  }

  async regenerateActionCard(savedItemId: string, options: RegenerateActionCardOptions = {}): Promise<ActionCardDraft> {
    const fallback = await Promise.resolve(this.fallback.regenerateActionCard(savedItemId, options));
    if (!this.config.apiKey) return this.withFallback(fallback, "AI API key is not configured", "blocked");
    try {
      const raw = await this.requestJson([{ role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT }, { role: "user", content: buildRegenerateActionCardPrompt({ savedItemId, ...options }) }]);
      const card = normalizeActionCardDraft(raw, fallback);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return card;
    } catch (error) {
      return this.withFallback(fallback, error instanceof Error ? error.message : String(error), "fallback");
    }
  }

  async summarizeImportBatch(batch: ImportBatch): Promise<ImportBatchSummary> {
    const fallback = await Promise.resolve(this.fallback.summarizeImportBatch(batch));
    if (!this.config.apiKey) return this.withFallback(fallback, "AI API key is not configured", "blocked");
    try {
      const raw = await this.requestJson([{ role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT }, { role: "user", content: buildImportBatchSummaryPrompt(batch) }]);
      const result = isRecord(raw) ? { title: readString(raw.title, fallback.title), summary: readString(raw.summary, fallback.summary), recommendedNextStep: readString(raw.recommendedNextStep, fallback.recommendedNextStep) } : fallback;
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return result;
    } catch (error) {
      return this.withFallback(fallback, error instanceof Error ? error.message : String(error), "fallback");
    }
  }

  async generateSearchKeywords(input: ShareInput): Promise<string[]> {
    const fallback = await Promise.resolve(this.fallback.generateSearchKeywords(input));
    if (!this.config.apiKey) return this.withFallback(fallback, "AI API key is not configured", "blocked");
    try {
      const raw = await this.requestJson([{ role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT }, { role: "user", content: buildSearchKeywordsPrompt(input) }]);
      const keywords = normalizeKeywordsResult(raw, fallback);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return keywords;
    } catch (error) {
      return this.withFallback(fallback, error instanceof Error ? error.message : String(error), "fallback");
    }
  }

  private async requestJson(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<unknown> {
    const baseUrl = (this.config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = this.config.model || "gpt-4.1-mini";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: "json_object" } })
      });
      if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
      const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI provider returned an empty response");
      const parsed = extractJsonFromText(content);
      if (parsed === undefined) throw new Error("AI provider returned invalid JSON");
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fallbackClassification(input: ShareInput, error: string, status: AiCallStatus): Promise<AiClassificationResult> {
    this.lastStatus = { ...getAiRuntimeStatus(this.config, status), fallbackActive: true, lastError: error };
    return this.fallback.classifyAndGenerateActionCard(input);
  }

  private withFallback<T>(value: T, error: string, status: AiCallStatus): T {
    this.lastStatus = { ...getAiRuntimeStatus(this.config, status), fallbackActive: true, lastError: error };
    return value;
  }
}

export function createMockAiProvider(options?: MockAiProviderOptions): MockAiProvider {
  return new MockAiProvider(options);
}

export function createAiProvider(config: AiProviderConfig = {}, fallback?: AiProvider): AiProvider {
  const provider = (config.provider || "mock").toLowerCase();
  return provider === "openai-compatible" || provider === "real" ? new OpenAICompatibleProvider(config, fallback ?? new MockAiProvider()) : new MockAiProvider();
}

export function getAiConfigFromEnv(env: Record<string, unknown>): AiProviderConfig {
  return {
    provider: typeof env.AI_PROVIDER === "string" ? (env.AI_PROVIDER as AiProviderMode) : "mock",
    apiKey: typeof env.AI_API_KEY === "string" ? env.AI_API_KEY : "",
    baseUrl: typeof env.AI_BASE_URL === "string" ? env.AI_BASE_URL : "",
    model: typeof env.AI_MODEL === "string" ? env.AI_MODEL : "",
    timeoutMs: typeof env.AI_TIMEOUT_MS === "string" ? Number(env.AI_TIMEOUT_MS) : undefined
  };
}

export function getAiRuntimeStatus(config: AiProviderConfig = {}, lastCallStatus: AiCallStatus = "idle"): AiRuntimeStatus {
  const provider = config.provider || "mock";
  const realMode = provider === "openai-compatible" || provider === "real";
  return { mode: realMode ? "real" : "mock", providerName: realMode ? "OpenAICompatibleProvider" : "MockAIProvider", modelName: realMode ? config.model || "gpt-4.1-mini" : "local-rules", apiKeyConfigured: Boolean(config.apiKey), lastCallStatus, fallbackActive: !realMode || !config.apiKey };
}

export function createAIProvider(config: AiProviderConfig = {}, fallback?: AiProvider): AiProvider {
  return createAiProvider(config, fallback);
}

export function isAiProviderPromise<T>(value: MaybePromise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === "function";
}

export interface AiClientOptions {
  endpoint?: string;
  fallback?: AiProvider;
  generateSmartAlbums?: (savedItems: SavedItem[], now?: Date) => SmartAlbum[];
  onStatusChange?: (status: AiRuntimeStatus) => void;
}

export class AiHttpClient implements AiProvider {
  readonly name = "server-proxy";
  private readonly fallback: AiProvider;
  private status: AiRuntimeStatus = { mode: "mock", providerName: "ServerAIProxy", modelName: "server-runtime", apiKeyConfigured: false, lastCallStatus: "idle", fallbackActive: true };

  constructor(private readonly options: AiClientOptions = {}) {
    this.fallback = options.fallback ?? new MockAiProvider({ generateSmartAlbums: options.generateSmartAlbums });
  }

  getStatus(): AiRuntimeStatus {
    return this.status;
  }

  async classifyAndGenerateActionCard(input: ShareInput): Promise<AiClassificationResult> {
    const fallback = await Promise.resolve(this.fallback.classifyAndGenerateActionCard(input));
    const data = await this.callTask<AiClassificationResult>("classify_action_card", input, fallback);
    return normalizeClassificationResult(data, input, fallback);
  }

  async generateSmartAlbums(input: GenerateSmartAlbumsInput): Promise<SmartAlbum[]> {
    const fallback = await Promise.resolve(this.fallback.generateSmartAlbums(input));
    const data = await this.callTask<SmartAlbum[]>("generate_smart_albums", input, fallback);
    return normalizeSmartAlbumsResult(data, input.savedItems, fallback, input.now);
  }

  async regenerateActionCard(savedItemId: string, options: RegenerateActionCardOptions = {}): Promise<ActionCardDraft> {
    const fallback = await Promise.resolve(this.fallback.regenerateActionCard(savedItemId, options));
    const data = await this.callTask<ActionCardDraft>("regenerate_action_card", { savedItemId, ...options }, fallback);
    return normalizeActionCardDraft(data, fallback);
  }

  async summarizeImportBatch(batch: ImportBatch): Promise<ImportBatchSummary> {
    const fallback = await Promise.resolve(this.fallback.summarizeImportBatch(batch));
    const data = await this.callTask<ImportBatchSummary>("summarize_import_batch", batch, fallback);
    return isRecord(data) ? { title: readString(data.title, fallback.title), summary: readString(data.summary, fallback.summary), recommendedNextStep: readString(data.recommendedNextStep, fallback.recommendedNextStep), fallbackUsed: Boolean(data.fallbackUsed ?? fallback.fallbackUsed) } : fallback;
  }

  async generateSearchKeywords(input: ShareInput): Promise<string[]> {
    const fallback = await Promise.resolve(this.fallback.generateSearchKeywords(input));
    const data = await this.callTask<string[]>("generate_search_keywords", input, fallback);
    return normalizeKeywordsResult(data, fallback);
  }

  private async callTask<T>(task: AiTask, payload: unknown, fallback: T): Promise<unknown> {
    try {
      const response = await fetch(this.options.endpoint ?? "/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, payload, fallback }) });
      const result = (await response.json()) as AiProxyResponse<T>;
      if (result.ok) {
        this.status = statusFromMeta(result.meta, "success");
        this.options.onStatusChange?.(this.status);
        return result.data;
      }
      this.status = { mode: "mock", providerName: "ServerAIProxy", modelName: "server-runtime", apiKeyConfigured: false, lastCallStatus: "fallback", fallbackActive: true, lastError: result.error.message };
    } catch (error) {
      this.status = { mode: "mock", providerName: "ServerAIProxy", modelName: "server-runtime", apiKeyConfigured: false, lastCallStatus: "fallback", fallbackActive: true, lastError: error instanceof Error ? error.message : String(error) };
    }
    this.options.onStatusChange?.(this.status);
    return fallback;
  }
}

export function createAiClient(options?: AiClientOptions): AiProvider {
  return new AiHttpClient(options);
}

function statusFromMeta(meta: AiResponseMeta, defaultStatus: AiCallStatus): AiRuntimeStatus {
  return { mode: meta.provider === "real" ? "real" : "mock", providerName: meta.providerName, modelName: meta.model, apiKeyConfigured: meta.apiKeyConfigured, lastCallStatus: meta.fallback ? "fallback" : defaultStatus, fallbackActive: meta.fallback, lastError: meta.reason };
}
type CategoryRule = {
  category: Category;
  subCategory: string;
  entityType: string;
  terms: string[];
  intent: string;
  whyThisCategory: string;
};

type CategoryInference = {
  category: Category;
  subCategory: string;
  confidence: ClassificationConfidence;
  intent: string;
  whyThisCategory: string;
};

type SavedIntentInference = {
  savedIntent: SavedIntent;
  secondaryIntents: SavedIntent[];
  whyThisIntent: string;
};

const categoryRules: CategoryRule[] = [
  { category: "内容创作", subCategory: "创作灵感", entityType: "creative_topic", terms: ["小红书", "账号运营", "笔记", "封面", "标题", "开头钩子", "评论区", "选题", "文案", "拍摄", "脚本", "图文", "排版", "短视频", "涨粉", "爆款", "内容运营"], intent: "用户可能想把这条收藏转成可发布的选题、封面结构、开头文案或内容复盘素材", whyThisCategory: "命中了内容创作、账号运营、标题封面或拍摄脚本相关线索" },
  { category: "AI 与效率", subCategory: "AI 工具", entityType: "tool", terms: ["AI工具", "AI 工具", "ChatGPT", "Claude", "Gemini", "Midjourney", "Codex", "codex", "代码助手", "AI编程", "AI 编程", "提示词", "prompt", "工作流", "自动化", "智能体", "插件", "工具清单", "SOP", "效率", "Notion", "Excel", "飞书", "办公"], intent: "用户可能想复现一个工具用法、提示词或工作流，并把它用进日常工作", whyThisCategory: "命中了 AI 工具、效率流程、自动化或 SOP 相关线索" },
  { category: "技能学习", subCategory: "技能练习", entityType: "skill", terms: ["剪辑", "摄影", "英语", "写作", "编程", "设计", "教程", "课程", "入门", "练习", "学习", "口语", "修图", "绘画", "训练"], intent: "用户可能想学习一个具体技能，并用一次小练习验证自己是否真的掌握", whyThisCategory: "命中了技能、教程、课程、练习或入门相关线索" },
  { category: "出行与探店", subCategory: "周末去处", entityType: "place", terms: ["旅行", "攻略", "路线", "城市", "大理", "深圳", "上海", "广州", "杭州", "北京", "成都", "周末", "展览", "徒步", "景点", "民宿", "交通", "探店", "咖啡", "餐厅", "甜品", "brunch", "夜市", "小吃", "人均", "营业时间"], intent: "用户可能想把地点、路线或店铺收藏变成一次可安排的出行候选", whyThisCategory: "命中了地点、路线、展览、探店或交通预算相关线索" },
  { category: "饮食与健康", subCategory: "家常备餐", entityType: "dish", terms: ["菜谱", "做饭", "低卡", "晚餐", "备餐", "早餐", "食材", "减脂餐", "空气炸锅", "购物清单", "鸡胸肉", "健身", "运动", "跑步", "瑜伽", "普拉提", "拉伸", "训练计划", "体态", "饮食控制"], intent: "用户可能想把饮食、备餐或健康收藏转成今天能执行的一份清单或训练", whyThisCategory: "命中了菜谱、备餐、低卡饮食或健康训练相关线索" },
  { category: "生活与家居", subCategory: "家居整理", entityType: "home_area", terms: ["收纳", "家居", "改造", "清洁", "租房", "整理", "衣柜", "厨房", "桌面", "软装", "灯光", "氛围", "断舍离", "换季", "布置", "家务"], intent: "用户可能想把家居、收纳或生活技巧变成一个小范围、可完成的整理任务", whyThisCategory: "命中了收纳、清洁、租房改造或家居布置相关线索" },
  { category: "穿搭与消费", subCategory: "风格参考", entityType: "style_or_product", terms: ["穿搭", "妆容", "发型", "护肤", "风格", "变美", "购物", "种草", "平替", "测评", "清单", "购买", "推荐", "避雷", "单品", "品牌", "价格", "优惠", "开箱", "好物"], intent: "用户可能想把风格或种草内容转成低成本尝试、替代清单或理性购买判断", whyThisCategory: "命中了穿搭变美、单品种草、品牌测评或购物决策相关线索" },
  { category: "情绪与关系", subCategory: "自我观察", entityType: "reflection_topic", terms: ["情绪", "自我成长", "内耗", "焦虑", "复盘", "手帐", "自我观察", "边界感", "疗愈", "表达", "需求", "关系", "亲密关系", "伴侣", "恋爱", "沟通", "吵架", "分手", "婚姻", "相处", "安全感", "原生家庭"], intent: "用户可能想把触动自己的观点变成一次自我观察、关系表达或复盘记录", whyThisCategory: "命中了情绪成长、表达需求、边界感或亲密关系相关线索" },
  { category: "读书与思考", subCategory: "读书笔记", entityType: "book_or_idea", terms: ["读书", "书单", "阅读", "读书笔记", "学习笔记", "论文", "知识", "课程笔记", "摘抄", "观点", "思考", "认知", "哲学", "历史", "写读后感"], intent: "用户可能想把阅读或观点收藏转成一条笔记、一段思考或一个继续追问的问题", whyThisCategory: "命中了读书、观点、笔记、摘抄或思考相关线索" }
];

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

const entityDictionary: Record<string, string[]> = {
  creative_topic: ["小红书", "封面", "标题", "选题", "文案", "脚本", "拍摄", "账号运营"],
  tool: ["ChatGPT", "Claude", "Gemini", "Midjourney", "Notion", "Excel", "飞书", "CapCut", "剪映", "Canva"],
  skill: ["剪辑", "摄影", "英语", "写作", "编程", "设计", "口语"],
  place: ["大理", "深圳", "上海", "广州", "杭州", "北京", "成都", "展览", "咖啡店", "餐厅", "徒步"],
  dish: ["低卡晚餐", "备餐", "鸡胸肉", "早餐", "空气炸锅", "减脂餐", "购物清单"],
  home_area: ["衣柜", "厨房", "桌面", "租房", "收纳", "清洁"],
  style_or_product: ["穿搭", "护肤", "妆容", "平替", "单品", "品牌"],
  reflection_topic: ["情绪", "关系", "表达需求", "边界", "安全感", "复盘"],
  book_or_idea: ["读书", "书单", "观点", "笔记", "摘抄"]
};

export function classifyAndGenerateActionCard(input: ShareInput): AiClassificationResult {
  const text = combineInput(input);
  const inference = inferCategoryWithConfidence(text, input);
  const savedIntent = inferSavedIntent(text, input, inference);
  const entities = extractEntities(text, inference.category);
  const keywords = extractKeywords(text, inference.category, inference.subCategory, entities);
  const summary = buildSummary(input, inference.category, inference.subCategory, keywords, inference.confidence);
  const actionCard = generateActionCard(inference.category, inference.subCategory, input, keywords, entities, inference.confidence, savedIntent.savedIntent);
  const searchableText = buildSearchableText(input, inference, summary, keywords, entities, actionCard, savedIntent);
  return {
    contentDomain: inference.category,
    contentSubDomain: inference.subCategory,
    savedIntent: savedIntent.savedIntent,
    secondaryIntents: savedIntent.secondaryIntents,
    confidence: inference.confidence,
    whyThisDomain: inference.whyThisCategory,
    whyThisIntent: savedIntent.whyThisIntent,
    category: inference.category,
    subCategory: inference.subCategory,
    intent: savedIntent.savedIntent,
    whyThisCategory: inference.whyThisCategory,
    summary,
    keywords,
    entities,
    searchableText,
    actionCard
  };
}

function combineInput(input: ShareInput): string {
  const extended = input as ShareInput & { visibleText?: string; keywords?: string[] };
  return [input.title, input.rawShareText, extended.visibleText, input.userNote, Array.isArray(extended.keywords) ? extended.keywords.join(" ") : "", input.sourceUrl].filter(Boolean).join(" ");
}

function inferCategoryWithConfidence(text: string, input: ShareInput): CategoryInference {
  const normalized = text.toLocaleLowerCase();
  const signalText = [input.title, input.rawShareText, input.userNote].filter(Boolean).join(" ").replace(/https?:\/\/\S+/g, "").trim();
  if (signalText.length < 4) return lowInfoInference("当前只有链接或极少文本，系统无法判断它更像学习、出行、做饭、创作还是消费。");

  const special = inferSpecialCategory(normalized);
  if (special) return special;

  const scored = categoryRules.map((rule) => ({ rule, score: rule.terms.reduce((sum, term) => normalized.includes(term.toLocaleLowerCase()) ? sum + (term.length >= 4 ? 2 : 1) : sum, 0) })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return lowInfoInference("没有命中足够明确的主题词，暂时不强行归到具体专辑。");
  const secondScore = scored[1]?.score ?? 0;
  const confidence: ClassificationConfidence = best.score >= 5 && best.score - secondScore >= 2 ? "high" : best.score >= 2 ? "medium" : "low";
  const subCategory = inferSubCategory(best.rule.category, normalized, best.rule.subCategory);
  return {
    category: best.rule.category,
    subCategory,
    confidence,
    intent: confidence === "low" ? `${best.rule.intent}；信息较少，先按最可能用途归类。` : best.rule.intent,
    whyThisCategory: confidence === "low" ? `${best.rule.whyThisCategory}，但当前线索较少，建议补充一句收藏原因。` : best.rule.whyThisCategory
  };
}

function inferSpecialCategory(normalized: string): CategoryInference | undefined {
  if (/(不用剪辑软件|ai\s*剪辑|ai剪辑|剪辑视频教程|视频教程)/i.test(normalized) && /剪辑|视频/.test(normalized)) {
    return {
      category: "内容创作",
      subCategory: "视频剪辑",
      confidence: "high",
      intent: "用户可能想学习或复现一个 AI 辅助的视频剪辑方法。",
      whyThisCategory: "虽然提到了 AI，但内容本身讲的是视频剪辑和内容制作，因此归入内容创作 / 视频剪辑。"
    };
  }
  if (/(长脑子最快|顶级好脑|jung|mankiw|munger|musk|多角色|圆桌|战略认知|决策辅助)/i.test(normalized)) {
    return {
      category: "AI 与效率",
      subCategory: /决策|战略|工作安排|时间分配/.test(normalized) ? "决策辅助" : "Prompt 工程",
      confidence: "high",
      intent: "用户可能想复现一个多角色 Prompt，用它辅助工作安排、商业认知或决策。",
      whyThisCategory: "核心内容是多角色 Prompt 和 AI 辅助决策，不因出现自媒体、写作或账号运营而改成内容创作。"
    };
  }
  return undefined;
}


function inferSavedIntent(text: string, input: ShareInput, inference: CategoryInference): SavedIntentInference {
  const noteText = input.userNote.toLocaleLowerCase();
  const allText = text.toLocaleLowerCase();
  const fromNote = pickIntentFromText(noteText);
  const primary = fromNote ?? pickIntentFromText(allText) ?? defaultIntentForCategory(inference.category);
  const secondary = [
    defaultIntentForCategory(inference.category),
    /复现|照着|教程|方法|prompt|提示词|codex|工作流/i.test(allText) ? "想复现" as SavedIntent : undefined,
    /写文章|写成内容|选题|封面|账号|小红书|自媒体/.test(noteText) ? "内容创作参考" as SavedIntent : undefined,
    /决策|工作安排|商业认知|时间分配|变现|效率|sop/i.test(allText) ? "工作决策参考" as SavedIntent : undefined
  ].filter((item): item is SavedIntent => Boolean(item));
  return {
    savedIntent: primary,
    secondaryIntents: unique([primary, ...secondary]).filter((intent) => intent !== primary) as SavedIntent[],
    whyThisIntent: buildIntentReason(primary, input, inference)
  };
}

function pickIntentFromText(text: string): SavedIntent | undefined {
  if (!text) return undefined;
  if (/写文章|写成内容|内容创作|选题|封面|账号|自媒体/.test(text)) return "内容创作参考";
  if (/决策|工作安排|商业认知|时间分配|变现|sop|流程|自动化|效率/.test(text)) return "工作决策参考";
  if (/复现|照着|复制|模仿|跑一遍|用到/.test(text)) return "想复现";
  if (/学习|学会|教程|训练|练习|入门/.test(text)) return "想学习";
  if (/想去|周末|旅行|展览|路线|探店|咖啡|餐厅/.test(text)) return "想去";
  if (/想买|购买|种草|平替|测评|价格|下单/.test(text)) return "想买";
  if (/做饭|做一次|执行|尝试|整理|改造/.test(text)) return "想做";
  if (/情绪|触动|共鸣|关系|复盘|手帐/.test(text)) return "情绪共鸣";
  return undefined;
}

function defaultIntentForCategory(category: ContentDomain): SavedIntent {
  if (category === "内容创作") return "内容创作参考";
  if (category === "AI 与效率") return "工作决策参考";
  if (category === "技能学习" || category === "读书与思考") return "想学习";
  if (category === "出行与探店") return "想去";
  if (category === "穿搭与消费") return "想买";
  if (category === "情绪与关系") return "情绪共鸣";
  if (category === "暂存") return "暂时保存";
  return "想做";
}

function buildIntentReason(intent: SavedIntent, input: ShareInput, inference: CategoryInference): string {
  if (input.userNote.trim()) return `优先参考了你的备注，判断这条收藏更像“${intent}”。`;
  return `根据标题和分享文本，它的内容主题是“${inference.category} / ${inference.subCategory}”，当前最可能的收藏用途是“${intent}”。`;
}
function lowInfoInference(whyThisCategory: string): CategoryInference {
  return { category: "暂存", subCategory: "待补充备注", confidence: "low", intent: "信息不足，先把它作为待补充收藏保存，之后补一句收藏原因再重新生成行动卡。", whyThisCategory };
}

function inferSubCategory(category: Category, text: string, fallback: string): string {
  const has = (...terms: string[]) => terms.some((term) => text.includes(term.toLocaleLowerCase()));
  if (category === "内容创作") {
    if (has("小红书", "账号运营", "涨粉", "笔记")) return "小红书运营";
    if (has("封面", "标题", "排版")) return "封面设计";
    if (has("选题", "文案", "脚本")) return "选题文案";
    if (has("拍摄", "短视频", "镜头")) return "拍摄脚本";
  }
  if (category === "AI 与效率") {
    if (has("prompt", "提示词", "多角色", "圆桌", "jung", "mankiw", "munger", "musk")) return "Prompt 工程";
    if (has("决策", "战略", "认知", "工作安排", "时间分配")) return "决策辅助";
    if (has("ai", "chatgpt", "claude", "智能体", "codex")) return "AI 工具";
    if (has("sop", "工作流", "自动化", "流程")) return "自动化工作流";
    if (has("职场", "汇报", "面试", "简历", "会议")) return "职场学习";
  }
  if (category === "技能学习") {
    if (has("剪辑", "视频")) return "剪辑学习";
    if (has("摄影", "拍照", "构图")) return "摄影练习";
    if (has("英语", "口语")) return "英语学习";
    if (has("写作")) return "写作练习";
  }
  if (category === "出行与探店") {
    if (has("咖啡", "餐厅", "甜品", "brunch", "探店", "夜市", "人均")) return "美食探店";
    if (has("展览", "美术馆", "博物馆")) return "展览活动";
    if (has("徒步", "周边游")) return "周边徒步";
    if (has("旅行", "攻略", "路线", "城市", "民宿")) return "旅行路线";
  }
  if (category === "饮食与健康") {
    if (has("菜谱", "做饭", "食材")) return "菜谱做饭";
    if (has("低卡", "减脂", "备餐", "晚餐", "早餐")) return "低卡备餐";
    if (has("健身", "运动", "瑜伽", "跑步", "训练")) return "健身运动";
  }
  if (category === "生活与家居") {
    if (has("租房", "软装", "灯光", "氛围")) return "租房改造";
    if (has("收纳", "衣柜", "整理")) return "收纳整理";
    if (has("清洁", "家务", "厨房")) return "清洁流程";
  }
  if (category === "穿搭与消费") {
    if (has("穿搭", "风格", "单品")) return "穿搭公式";
    if (has("妆容", "护肤", "发型")) return "变美参考";
    if (has("购物", "种草", "平替", "测评", "品牌")) return "购物参考";
  }
  if (category === "情绪与关系") {
    if (has("关系", "伴侣", "恋爱", "表达需求", "边界", "沟通")) return "亲密关系";
    if (has("情绪", "焦虑", "内耗", "自我成长")) return "情绪成长";
    if (has("手帐", "复盘", "自我观察")) return "自我观察";
  }
  if (category === "读书与思考") {
    if (has("书单", "读书", "阅读")) return "读书学习";
    if (has("笔记", "摘抄")) return "读书笔记";
    if (has("观点", "思考", "认知")) return "观点思考";
  }
  return fallback;
}

function extractEntities(text: string, category: Category): EntityTag[] {
  const rule = categoryRules.find((item) => item.category === category);
  const entityType = rule?.entityType ?? "topic";
  const values = Object.values(entityDictionary).flat().filter((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  return unique(values).slice(0, 8).map((value) => ({ type: entityType, value }));
}

function extractKeywords(text: string, category: Category, subCategory: string, entities: EntityTag[]): string[] {
  const dictionaryMatches = Object.values(entityDictionary).flat().filter((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  const words = text.split(/[\s,，。；;、|/]+/).filter((part) => part.length >= 2 && part.length <= 14 && !/^https?:/i.test(part));
  return unique([category, subCategory, ...entities.map((entity) => entity.value), ...dictionaryMatches, ...words].map(cleanKeyword).filter(Boolean)).slice(0, 12);
}

function buildSummary(input: ShareInput, category: Category, subCategory: string, keywords: string[], confidence: ClassificationConfidence): string {
  const topic = cleanTitle(input.title || input.rawShareText || input.userNote || keywords[0] || "这条收藏").slice(0, 48);
  if (category === "暂存" || confidence === "low") return `这条收藏目前信息偏少，系统先按“${subCategory}”保存；补充一句收藏原因后，可以生成更具体的行动建议。`;
  return `这条收藏看起来与“${subCategory}”有关，可以先围绕“${topic}”做一个 5-30 分钟的小行动，而不是继续放在收藏夹里。`;
}
function generateActionCard(category: Category, subCategory: string, input: ShareInput, keywords: string[], entities: EntityTag[], confidence: ClassificationConfidence, savedIntent: SavedIntent | ReviveIntent | string): ActionCardDraft {
  const topic = pickTopic(input, keywords, entities, category);
  if (category === "暂存" || confidence === "low" || isLowInformationInput(input)) return buildLowInfoCard(topic, input, keywords, String(savedIntent));
  const common = { category, subCategory, topic };

  if (category === "内容创作") return card(common, "创作复用卡", `把“${topic}”转成 1 条能放进自己账号的选题或封面结构。`, "你收藏它大概率不是为了再看一遍，而是想复用标题、封面、开头或内容结构。", `打开原帖，只看“标题结构、封面构图、开头钩子、评论区高频问题”四处；用你的账号方向改写 1 个选题标题。`, ["原帖标题", "封面构图", "开头钩子", "评论区高频问题"], "1 条可发布选题或 1 个封面结构草稿", "20分钟", "中", "写出 1 个自己的选题标题，并标注它借鉴了原帖的哪个结构。", "不要整篇照抄，也不要一次整理成庞大的选题库。", "如果看不出可复用点，先补一句：我想借鉴它的标题、封面、内容结构还是评论洞察。", "如果这个选题能用，再把它加入本周创作计划。", [task("圈出 4 个复用点", "打开原帖，分别记下标题结构、封面构图、开头钩子、评论区问题。", "8分钟"), task("改写 1 个选题", "把复用点套到自己的账号方向，只写 1 条标题。", "8分钟"), task("保存产出", "把选题标题和借鉴点写进行动卡备注。", "4分钟")], { 可复用结构: ["标题结构", "封面构图", "开头钩子", "评论区问题"] });

  if (category === "AI 与效率" || category === "技能学习") {
    const isAi = category === "AI 与效率";
    const noSource = !input.sourceUrl.trim();
    const nextAction = noSource
      ? isAi
        ? `先补充原帖链接，或把“${topic}”里提到的方法粘到分享文案/备注；今天只选 1 个方法用到自己的项目里，产出 1 条 Codex 或 AI 工作流记录。`
        : `先补充原帖链接，或把“${topic}”里的步骤粘到分享文案/备注；今天只复现第一个步骤，产出 1 个练习记录。`
      : isAi
        ? "打开原帖，找到第一个工具名和第一个操作步骤；今天只复现这一步，留下 1 张截图或 1 段可复用 prompt。"
        : "打开原帖，找到作者给的第一个练习动作；今天只做这一小步，并留下 1 个截图、片段或练习记录。";
    const focus = noSource
      ? ["分享文本里的方法", "工具名", "自己的项目场景", "需要补充的步骤"]
      : isAi
        ? ["工具名", "第一个操作步骤", "示例输入", "示例产出"]
        : ["练习步骤", "示例作品", "注意事项", "完成标准"];
    return card(common, isAi ? "复现卡" : "练习卡", isAi ? `把“${topic}”里的一个工具步骤复现出来。` : `用“${topic}”完成一次最小练习。`, isAi ? "你可能想把这个工具或工作流真正用到自己的任务里。" : "你可能想学习这个技能，但需要先做一次小练习确认入口。", nextAction, focus, isAi ? "1 张截图、1 段 prompt 或 1 个小自动化步骤" : "1 个小作品、练习截图或 3 行练习记录", "20分钟", "中", isAi ? "复现出第一个可见结果，并保存截图、prompt 或工作流记录。" : "完成第一个练习动作，并记录哪里卡住。", "不要一口气学完整教程，也不要先收藏更多同类内容。", "如果不知道工具名或练习步骤，先补充原帖链接，或把关键步骤粘到分享文案/备注再重新生成。", "如果第一个步骤可用，再把它整理成自己的 SOP 或 3 天练习。", [task("定位第一步", isAi ? "找出工具名、入口和第一个操作步骤。" : "找出作者建议的第一个练习动作。", "6分钟"), task("只复现一次", isAi ? "按原帖或备注做出第一个示例结果。" : "完成一个最小练习，不追求完美。", "10分钟"), task("保存证据", isAi ? "保存截图、prompt 或工作流记录，方便下次继续。" : "写下 1 句卡点和 1 句下次要练什么。", "4分钟")], { 学习目标: isAi ? "复现一个可用工具步骤" : "完成一次最小技能练习" });
  }

  if (category === "出行与探店") return card(common, /探店|咖啡|餐厅|甜品|brunch|夜市|人均/.test(`${topic} ${keywords.join(" ")}`) ? "探店候选卡" : "周末计划卡", `把“${topic}”变成一个可决定去不去的候选安排。`, "你可能是被地点、路线或店铺吸引了，但需要先确认时间、交通和预算。", "打开原帖，确认地点、营业时间或开放时间、交通方式和预算；给它加 1 个候选日期，产出一个周末计划草稿。", ["地点/店名", "时间", "交通方式", "预算/人均", "评论区补充"], "1 个周末计划草稿", "15分钟", "低", "写下候选日期、到达方式、预算和是否需要预约。", "不要直接把很多地点塞进行程，先判断这一条值不值得去。", "如果缺地点或时间，先打开原帖补齐，再决定是否加入计划。", "如果确认值得去，把它加入计划库或今日行动。", [task("确认基础信息", "记录地点/店名、时间、交通和预算。", "7分钟"), task("加一个候选日期", "选一个真实可能去的日期，不用马上约人。", "4分钟"), task("判断优先级", "写下为什么值得去，以及一个避坑点。", "4分钟")], { 地点名称: topic, 交通建议: "打开原帖确认最近地铁/停车/步行距离", 预算区间: "打开原帖确认人均或门票" });

  if (category === "饮食与健康") {
    const fitnessLike = /健身|运动|瑜伽|跑步|训练|拉伸|普拉提/.test(`${topic} ${keywords.join(" ")}`);
    return card(common, fitnessLike ? "今日训练卡" : "购物清单卡", fitnessLike ? `把“${topic}”变成一次 20 分钟以内的练习。` : `把“${topic}”变成今天能买、能做的一张清单。`, fitnessLike ? "你可能想尝试这个训练方法，但先从一个最小动作开始更容易坚持。" : "你可能想少点外卖或改善饮食，第一步是把食材从原帖里抄出来。", fitnessLike ? "打开原帖，找到第一个动作、组数和注意事项；今天只做 1 轮，并记录身体感受。" : "打开原帖，抄下食材清单，标记家里已有和需要购买的材料；产出 1 张购物清单。", fitnessLike ? ["第一个动作", "组数/时长", "注意事项", "评论区纠错"] : ["食材清单", "作者给的步骤", "替代材料", "保存/备餐方式"], fitnessLike ? "1 条训练感受记录" : "1 张购物清单", fitnessLike ? "20分钟" : "10分钟", "低", fitnessLike ? "完成 1 轮动作并写下感受。" : "列出已有食材和需要购买的食材。", fitnessLike ? "不要一开始追求完整训练计划。" : "不要先研究复杂做法，先确认材料够不够。", "如果缺材料、动作或组数，先打开原帖补齐关键字段。", fitnessLike ? "如果身体感受不错，再安排下一次。" : "如果材料齐了，把它加入今晚或明天的备餐。", [task("抄关键清单", fitnessLike ? "记录第一个动作、组数和注意事项。" : "抄下食材，并标记已有/需买。", "5分钟"), task("执行最小一步", fitnessLike ? "只做 1 轮，不追求强度。" : "只整理购物清单，不急着开火。", "10分钟"), task("保存结果", fitnessLike ? "写下身体感受。" : "把清单保存到行动卡。", "5分钟")], { 菜名或训练主题: topic, 购物清单: fitnessLike ? [] : keywords.filter((keyword) => ![category, subCategory].includes(keyword)).slice(0, 6) });
  }

  if (category === "生活与家居") return card(common, "30 分钟整理卡", `从“${topic}”里选一个不超过 1 平米的小区域开始。`, "你可能想改善生活空间，但真正能启动的是一个小区域，而不是整屋改造。", "打开原帖，选一个不超过 1 平米的小区域；列出需要移动、丢掉、购买的东西，产出一个 30 分钟整理任务。", ["改造区域", "采购清单", "前后对比", "注意事项"], "1 个 30 分钟整理任务", "30分钟", "低", "明确一个区域、三类动作和一个完成时间。", "不要一开始买很多收纳用品，也不要把范围扩大到整个房间。", "如果不知道从哪里开始，先写下家里最想改善的 1 个小角落。", "完成后拍一张前后对比，再决定是否继续下一个区域。", [task("缩小区域", "只选一个桌面、抽屉、衣柜格或厨房台面。", "5分钟"), task("列三类动作", "分别写下要移动、丢掉、购买的东西。", "10分钟"), task("安排 30 分钟", "给这个任务放进一个真实时间段。", "5分钟")], { 操作步骤: ["选 1 平米以内区域", "列移动/丢掉/购买", "安排 30 分钟执行"] });

  if (category === "穿搭与消费") return card(common, "低成本尝试卡", `把“${topic}”从种草变成一次理性的风格或购买判断。`, "你可能被风格、单品或测评吸引了，但先判断自己是否已有替代品更稳。", "打开原帖，提取 3 个风格关键词和 1 个核心单品；检查自己是否已有类似物，产出一个低成本替代清单。", ["风格关键词", "核心单品", "价格/品牌", "替代方案", "评论区避雷"], "1 个低成本替代清单", "15分钟", "低", "写出 3 个风格词、1 个核心单品和 1 个已有替代方案。", "不要马上下单，先用已有物品模拟一次。", "如果缺品牌、价格或单品名，先打开原帖补齐。", "如果没有替代品，再把它加入购物候选，而不是立刻购买。", [task("提取风格词", "从原帖写下 3 个风格关键词。", "5分钟"), task("找核心单品", "记录最关键的单品、品牌或价格。", "5分钟"), task("做替代判断", "检查自己是否已有类似物，写下替代方案。", "5分钟")], { 风格关键词: keywords.slice(0, 4), 单品清单: [topic], 低成本替代方案: "先检查已有类似单品，再决定是否购买" });

  if (category === "情绪与关系" || category === "读书与思考") {
    const relationLike = category === "情绪与关系";
    return card(common, relationLike ? "自我观察卡" : "思考笔记卡", relationLike ? `把“${topic}”转成一条自我观察，而不是停留在被触动。` : `把“${topic}”转成一条自己的笔记或追问。`, relationLike ? "你可能是被某个观点击中，需要把它放回自己的真实处境里。" : "你可能想保留一个观点，但真正有用的是写出自己的理解。", relationLike ? "打开原帖，摘出 1 句最触动你的观点；写 1 个自己的例子，并判断它适合进入手帐、复盘还是待办。" : "打开原帖，摘出 1 个最想保留的观点；用自己的话改写 3 句，并写下 1 个还想追问的问题。", relationLike ? ["最触动的观点", "作者给的例子", "适用边界", "评论区补充"] : ["核心观点", "书名/章节", "作者例子", "可继续追问的问题"], relationLike ? "1 条自我观察记录" : "3 句话笔记 + 1 个追问", "15分钟", "低", relationLike ? "写下观点、自己的例子和它归属手帐/复盘/待办的判断。" : "完成 3 句改写和 1 个追问。", "不要把它变成空泛鸡汤，也不要要求自己立刻解决整个问题。", "如果不知道哪里触动你，先写下当时为什么收藏它。", relationLike ? "如果它和真实关系有关，再选一个更温和的表达动作。" : "如果这个追问有价值，把它加入读书或写作素材。", [task("摘一句", relationLike ? "摘出最触动你的观点。" : "摘出最想保留的观点。", "4分钟"), task("写自己的例子", relationLike ? "写一个最近发生在自己身上的例子。" : "用自己的话改写 3 句。", "8分钟"), task("决定去处", relationLike ? "判断它进手帐、复盘还是待办。" : "写下一个继续追问的问题。", "3分钟")], { 核心观点: topic });
  }

  return buildLowInfoCard(topic, input, keywords, String(savedIntent));
}

function buildLowInfoCard(topic: string, input: ShareInput, keywords: string[], intent: string): ActionCardDraft {
  return card({ category: "暂存", subCategory: "待补充备注", topic }, "补全信息卡", "先判断这条收藏之后到底要如何使用。", intent || "当前信息不足，系统只能先把它当作待补充线索。", "打开原帖，确认它是想学、想去、想买、想做还是想创作；补一句你为什么收藏它，再重新生成行动卡。", ["原帖标题", "作者给的步骤", "地点/时间/价格", "工具名/材料名", "你当初收藏的原因"], "1 句收藏原因 + 重新生成后的行动卡", "10分钟", "低", "补充一句具体备注，例如：下周末想去 / 想复现这个工具 / 想借鉴封面。", "不要只保存链接就期待系统理解完整意图。", "把用户备注补到 8 个字以上，再重新生成。", "重新生成后，再决定加入今日行动还是智能专辑。", [task("确认用途", "从想学、想去、想买、想做、想创作里选一个。", "3分钟"), task("补一句备注", "写下当初为什么想收藏它。", "4分钟"), task("重新生成", "补完后重新生成行动卡。", "3分钟")], { 内容摘要: buildSummary(input, "暂存", "待补充备注", keywords, "low"), 相关关键词: keywords, 是否建议重新分类: "建议补充一句备注后重新生成" });
}

type CardCommon = { category: Category; subCategory: string; topic: string };

function card(common: CardCommon, suffix: string, goal: string, whySaved: string, nextAction: string, openOriginalFocus: string[], output: string, estimatedTime: string, difficulty: "低" | "中" | "高", doneCriteria: string, avoidDoing: string, ifInfoMissing: string, followUp: string, tasks: TaskDraft[], structuredFields: Record<string, string | string[]>): ActionCardDraft {
  return {
    title: buildCardTitle(common.topic, suffix),
    goal,
    whySaved,
    nextAction,
    openOriginalFocus,
    output,
    estimatedTime,
    difficulty,
    doneCriteria,
    avoidDoing,
    ifInfoMissing,
    followUp,
    tasks: tasks.slice(0, 3),
    structuredFields: { 分类: common.category, 二级分类: common.subCategory, 主题: common.topic, ...structuredFields, 收藏意图: whySaved, 打开原帖后重点看什么: openOriginalFocus, 产出物: output, 完成标准: doneCriteria, 避免: avoidDoing }
  };
}

function task(title: string, description: string, estimatedTime: string): TaskDraft {
  return { title, description, estimatedTime };
}

function buildSearchableText(input: ShareInput, inference: CategoryInference, summary: string, keywords: string[], entities: EntityTag[], actionCard: ActionCardDraft, savedIntent: SavedIntentInference): string {
  const fieldText = Object.entries(actionCard.structuredFields).flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : value]).join(" ");
  const taskText = actionCard.tasks.map((item) => `${item.title} ${item.description}`).join(" ");
  const entityText = entities.map((item) => `${item.type}:${item.value}`).join(" ");
  return [input.sourceUrl, input.rawShareText, input.title, input.userNote, inference.category, inference.subCategory, savedIntent.savedIntent, savedIntent.secondaryIntents.join(" "), inference.intent, inference.whyThisCategory, savedIntent.whyThisIntent, summary, keywords.join(" "), entityText, actionCard.title, actionCard.goal, actionCard.whySaved, actionCard.nextAction, actionCard.openOriginalFocus.join(" "), actionCard.output, actionCard.doneCriteria, actionCard.avoidDoing, actionCard.ifInfoMissing, actionCard.followUp, fieldText, taskText].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function pickTopic(input: ShareInput, keywords: string[], entities: EntityTag[], category: Category): string {
  const title = sanitizeBaseTitle(input.title || input.rawShareText || input.userNote);
  return title || entities[0]?.value || keywords.find((item) => item !== category) || category;
}

function sanitizeBaseTitle(value: string): string {
  return cleanTitle(value).replace(/行动卡|复刻卡|补全信息卡|练习卡|复现卡|专辑/g, "").replace(/\s+/g, " ").trim().slice(0, 28);
}

function buildCardTitle(topic: string, suffix: string): string {
  const base = sanitizeBaseTitle(topic) || "这条收藏";
  return `${base}｜${suffix}`.replace(/行动卡行动卡/g, "行动卡").replace(/其他行动卡/g, "补全信息卡").replace(/卡卡/g, "卡");
}

function isLowInformationInput(input: ShareInput): boolean {
  return [input.title, input.rawShareText, input.userNote].filter(Boolean).join(" ").replace(/https?:\/\/\S+/g, "").trim().length < 6;
}

function cleanKeyword(value: string): string {
  return value.replace(/[《》【】#]/g, "").trim();
}

function cleanTitle(value: string): string {
  return value.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeCategoryAlias(value: unknown, fallback: { category: Category; subCategory: string }): { category: Category; subCategory: string } {
  if (typeof value !== "string") return fallback;
  if ((CATEGORIES as readonly string[]).includes(value)) return { category: value as Category, subCategory: fallback.subCategory };
  return legacyCategoryAliases[value] ?? fallback;
}