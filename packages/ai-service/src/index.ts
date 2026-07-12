import { CATEGORIES } from "@revival/shared-types";
import type {
  ActionCardDraft,
  AiClassificationResult,
  Category,
  EntityTag,
  ImportBatch,
  SavedItem,
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

type CategoryRule = {
  category: Category;
  terms: string[];
  intent: string;
};

const categoryRules: CategoryRule[] = [
  {
    category: "小红书运营",
    terms: ["小红书", "账号运营", "涨粉", "爆款", "笔记", "封面", "标题", "开头钩子", "评论区", "图文排版", "内容运营", "种草", "选题库", "账号定位", "发布节奏"],
    intent: "用户可能想把这条内容拆成可复用的小红书选题、封面或运营动作"
  },
  {
    category: "内容创作",
    terms: ["选题", "文案", "封面", "拍摄", "脚本", "标题", "开头", "钩子", "素材", "审美", "图文", "排版", "短视频", "镜头", "内容结构", "创作", "公众号", "视频号"],
    intent: "用户可能想把这条内容变成一个可发布选题、封面结构或创作素材"
  },
  {
    category: "AI工具",
    terms: ["AI工具", "AI 工具", "ChatGPT", "Claude", "Gemini", "Midjourney", "提示词", "prompt", "工作流", "自动化", "智能体", "插件", "工具清单", "AIGC"],
    intent: "用户可能想复现一个 AI 工具用法，并把它放进自己的工作流"
  },
  {
    category: "职场学习",
    terms: ["职场", "面试", "简历", "汇报", "述职", "沟通", "管理", "复盘", "会议", "项目管理", "向上管理", "OKR", "PPT", "求职"],
    intent: "用户可能想把职场方法转成一次可练习、可复用的工作动作"
  },
  {
    category: "情绪成长",
    terms: ["情绪", "自我成长", "内耗", "焦虑", "复盘", "手帐", "自我观察", "边界感", "疗愈", "表达", "需求", "人格", "原生家庭"],
    intent: "用户可能想把触动自己的观点变成一次自我观察或复盘"
  },
  {
    category: "亲密关系",
    terms: ["关系", "亲密关系", "伴侣", "恋爱", "沟通", "表达需求", "边界", "吵架", "分手", "婚姻", "相处", "安全感"],
    intent: "用户可能想把关系中的观点转成一次更清楚的表达或反思"
  },
  {
    category: "购物参考",
    terms: ["购物", "种草", "平替", "测评", "清单", "购买", "推荐", "避雷", "单品", "品牌", "价格", "优惠", "开箱", "好物"],
    intent: "用户可能想把种草内容变成更理性的购买判断或替代清单"
  },
  {
    category: "健身运动",
    terms: ["健身", "运动", "跑步", "瑜伽", "力量训练", "减脂", "塑形", "普拉提", "拉伸", "训练计划", "体态", "饮食控制"],
    intent: "用户可能想把运动收藏转成一次低门槛训练或计划"
  },
  {
    category: "读书学习",
    terms: ["读书", "书单", "阅读", "读书笔记", "学习笔记", "论文", "知识", "课程", "教材", "摘抄", "精读", "复习"],
    intent: "用户可能想把阅读或学习收藏转成一个可完成的小学习任务"
  },
  {
    category: "生活方式",
    terms: ["生活方式", "周末", "日常", "仪式感", "城市生活", "松弛", "生活清单", "体验", "展览", "市集", "散步", "约会", "独处"],
    intent: "用户可能想把一个生活灵感安排到真实的时间和场景里"
  },
  {
    category: "技能学习",
    terms: ["剪辑", "摄影", "英语", "写作", "编程", "设计", "教程", "入门", "课程", "练习", "学习", "训练", "工具课", "PS", "剪映", "CapCut"],
    intent: "用户可能想学习某项技能，并在之后通过练习把收藏内容用起来"
  },
  {
    category: "旅行地点",
    terms: ["旅行", "攻略", "景点", "城市", "路线", "民宿", "展览", "周边游", "周末", "大理", "深圳", "上海", "北京", "杭州", "成都", "广州", "海边", "徒步", "露营", "地铁"],
    intent: "用户可能想把一个地点、路线或展览放进未来出行计划"
  },
  {
    category: "美食探店",
    terms: ["餐厅", "咖啡", "甜品", "夜市", "小吃", "探店", "店", "预约", "人均", "火锅", "烤肉", "brunch", "下午茶", "面包", "酒馆", "咖啡店"],
    intent: "用户可能想之后去这家店或把它加入约会、聚餐、周末清单"
  },
  {
    category: "菜谱做饭",
    terms: ["菜谱", "做饭", "家常菜", "减脂餐", "低卡", "甜品", "饮品", "备餐", "食材", "烹饪", "早餐", "午餐", "晚餐", "空气炸锅", "烤箱", "便当", "料理"],
    intent: "用户可能想复刻一道菜或把它加入日常备餐计划"
  },
  {
    category: "穿搭变美",
    terms: ["穿搭", "妆容", "发型", "护肤", "拍照姿势", "单品", "口红", "精华", "风格", "变美", "显瘦", "配色", "发色", "美甲"],
    intent: "用户可能想获得一个具体造型、妆发或护肤动作"
  },
  {
    category: "家居生活",
    terms: ["收纳", "家居", "改造", "清洁", "氛围", "布置", "租房", "软装", "整理", "厨房", "衣柜", "卫生间", "断舍离", "房间"],
    intent: "用户可能想在家里完成一次整理、采购或微改造"
  },
  {
    category: "工作效率",
    terms: ["sop", "SOP", "时间管理", "办公", "效率", "自动化", "流程", "Notion", "Excel", "飞书", "模板", "表格", "快捷键", "待办", "知识库"],
    intent: "用户可能想复制一个工作流，降低重复劳动"
  },
  {
    category: "灵感素材",
    terms: ["灵感", "参考", "素材", "审美", "配色", "排版", "图片参考", "封面参考", "拍摄灵感", "文案灵感", "案例", "模板"],
    intent: "用户可能想把这条内容转化成创作素材或选题储备"
  }
];
const categoryEntityTypes: Record<Category, string> = {
  技能学习: "skill",
  内容创作: "creative",
  小红书运营: "creative",
  AI工具: "tool",
  职场学习: "career",
  旅行地点: "place",
  美食探店: "shop",
  菜谱做饭: "dish",
  穿搭变美: "style",
  购物参考: "product",
  家居生活: "home",
  生活方式: "life",
  情绪成长: "emotion",
  亲密关系: "relationship",
  健身运动: "fitness",
  读书学习: "book",
  工作效率: "tool",
  灵感素材: "creative",
  其他: "topic"
};

const entityHints: Record<string, string[]> = {
  place: ["大理", "深圳", "上海", "北京", "杭州", "成都", "广州", "苏州", "厦门", "长沙", "重庆", "南京", "西安", "海边", "展览", "民宿", "徒步", "周末"],
  shop: ["咖啡", "咖啡店", "餐厅", "甜品", "夜市", "小吃", "火锅", "烤肉", "brunch", "面包", "酒馆"],
  dish: ["低卡晚餐", "早餐", "减脂餐", "家常菜", "甜品", "饮品", "便当", "鸡胸肉", "沙拉", "咖喱", "蛋糕", "备餐"],
  skill: ["剪辑", "摄影", "英语", "写作", "编程", "设计", "CapCut", "剪映", "Notion"],
  tool: ["AI工具", "ChatGPT", "Claude", "Gemini", "Notion", "Excel", "飞书", "自动化", "SOP", "模板", "提示词", "prompt"],
  career: ["面试", "简历", "述职", "汇报", "项目管理", "向上管理", "PPT"],
  style: ["通勤", "法式", "显瘦", "妆容", "发型", "护肤", "拍照姿势", "配色", "单品"],
  product: ["平替", "测评", "单品", "品牌", "价格", "购物清单", "避雷"],
  home: ["收纳", "租房", "厨房", "衣柜", "清洁", "软装", "氛围灯", "卫生间"],
  life: ["周末", "展览", "市集", "散步", "约会", "独处", "生活清单"],
  emotion: ["情绪", "内耗", "焦虑", "自我观察", "复盘", "手帐", "边界感"],
  relationship: ["亲密关系", "伴侣", "恋爱", "表达需求", "沟通", "边界", "安全感"],
  fitness: ["健身", "跑步", "瑜伽", "力量训练", "减脂", "普拉提", "拉伸"],
  book: ["书单", "读书笔记", "阅读", "摘抄", "精读", "学习笔记"],
  creative: ["选题", "文案", "封面", "脚本", "拍摄", "标题", "账号运营", "审美", "图文排版", "开头钩子"],
  topic: ["收藏", "参考", "灵感"]
};
export type AiProviderMode = "mock" | "openai-compatible" | "real";
export type AiCallStatus = "idle" | "success" | "fallback" | "blocked" | "failed";
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
    return {
      mode: "mock",
      providerName: "MockAIProvider",
      modelName: "local-rules",
      apiKeyConfigured: false,
      lastCallStatus: "success",
      fallbackActive: false
    };
  }

  classifyAndGenerateActionCard(input: ShareInput): AiClassificationResult {
    return classifyAndGenerateActionCard(input);
  }

  generateSmartAlbums(input: GenerateSmartAlbumsInput): SmartAlbum[] {
    return this.options.generateSmartAlbums?.(input.savedItems, input.now) ?? [];
  }

  regenerateActionCard(_savedItemId: string, options: RegenerateActionCardOptions = {}): ActionCardDraft {
    const source = options.savedItem;
    const shareInput: ShareInput = {
      sourceUrl: source?.sourceUrl ?? "",
      title: options.title ?? source?.title ?? "",
      rawShareText: options.rawShareText ?? source?.rawShareText ?? "",
      userNote: options.userNote ?? source?.userNote ?? ""
    };
    return classifyAndGenerateActionCard(shareInput).actionCard;
  }

  summarizeImportBatch(batch: ImportBatch): ImportBatchSummary {
    return {
      title: batch.title,
      summary: `Imported ${batch.importedCount} of ${batch.rawCount} items with ${batch.duplicateCount} duplicates and ${batch.failedCount} failures.`,
      recommendedNextStep: batch.importedCount > 0 ? "Open smart albums and pick three items to revive first." : "Fix failed or duplicate import items before continuing.",
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
    if (!this.config.apiKey) return this.fallbackClassification(input, "AI API key is not configured", "blocked");

    try {
      const raw = await this.requestJson([
        { role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT },
        { role: "user", content: buildClassifyActionCardPrompt(input) }
      ]);
      const result = normalizeClassificationResult(raw, input, classifyAndGenerateActionCard(input));
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return result;
    } catch (error) {
      return this.fallbackClassification(input, error instanceof Error ? error.message : String(error), "fallback");
    }
  }

  async generateSmartAlbums(input: GenerateSmartAlbumsInput): Promise<SmartAlbum[]> {
    if (!this.config.apiKey) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "blocked"), fallbackActive: true, lastError: "AI API key is not configured" };
      return this.fallback.generateSmartAlbums(input) as SmartAlbum[];
    }

    const safeInput = {
      savedItems: input.savedItems.slice(0, 30).map((item) => ({
        id: item.id,
        title: item.title,
        category: item.category,
        summary: item.summary,
        keywords: item.keywords,
        entities: item.entities,
        status: item.status,
        createdAt: item.createdAt
      })),
      existingAlbums: input.existingAlbums?.map((album) => ({ id: album.id, title: album.title, status: album.status })) ?? []
    };
    const fallback = await Promise.resolve(this.fallback.generateSmartAlbums(input));

    try {
      const raw = await this.requestJson([
        { role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT },
        { role: "user", content: buildSmartAlbumsPrompt(safeInput) }
      ]);
      const result = normalizeSmartAlbumsResult(raw, input.savedItems, fallback, input.now);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return result;
    } catch (error) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "fallback"), fallbackActive: true, lastError: error instanceof Error ? error.message : String(error) };
      return fallback;
    }
  }

  async regenerateActionCard(savedItemId: string, options: RegenerateActionCardOptions = {}): Promise<ActionCardDraft> {
    const item = options.savedItem;
    const input = {
      sourceUrl: item?.sourceUrl ?? "",
      title: options.title ?? item?.title ?? "",
      rawShareText: options.rawShareText ?? item?.rawShareText ?? "",
      userNote: options.userNote ?? item?.userNote ?? ""
    };
    const fallback = await Promise.resolve(this.fallback.regenerateActionCard(savedItemId, options));

    if (!this.config.apiKey) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "blocked"), fallbackActive: true, lastError: "AI API key is not configured" };
      return fallback;
    }

    try {
      const raw = await this.requestJson([
        { role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT },
        { role: "user", content: buildRegenerateActionCardPrompt(input) }
      ]);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return normalizeActionCardDraft(isRecord(raw) && isRecord(raw.actionCard) ? raw.actionCard : raw, fallback);
    } catch (error) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "fallback"), fallbackActive: true, lastError: error instanceof Error ? error.message : String(error) };
      return fallback;
    }
  }

  async summarizeImportBatch(batch: ImportBatch): Promise<ImportBatchSummary> {
    const fallback = await Promise.resolve(this.fallback.summarizeImportBatch(batch));
    if (!this.config.apiKey) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "blocked"), fallbackActive: true, lastError: "AI API key is not configured" };
      return fallback;
    }

    try {
      const raw = await this.requestJson([
        { role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT },
        { role: "user", content: buildImportBatchSummaryPrompt(batch) }
      ]);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return isRecord(raw)
        ? {
            title: readString(raw.title, fallback.title),
            summary: readString(raw.summary, fallback.summary),
            recommendedNextStep: readString(raw.recommendedNextStep, fallback.recommendedNextStep),
            fallbackUsed: false
          }
        : fallback;
    } catch (error) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "fallback"), fallbackActive: true, lastError: error instanceof Error ? error.message : String(error) };
      return fallback;
    }
  }

  async generateSearchKeywords(input: ShareInput): Promise<string[]> {
    const fallback = await Promise.resolve(this.fallback.generateSearchKeywords(input));
    if (!this.config.apiKey) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "blocked"), fallbackActive: true, lastError: "AI API key is not configured" };
      return fallback;
    }

    try {
      const raw = await this.requestJson([
        { role: "system", content: COLLECTION_REVIVAL_SYSTEM_PROMPT },
        { role: "user", content: buildSearchKeywordsPrompt(input) }
      ]);
      this.lastStatus = getAiRuntimeStatus(this.config, "success");
      return normalizeKeywordsResult(raw, fallback);
    } catch (error) {
      this.lastStatus = { ...getAiRuntimeStatus(this.config, "fallback"), fallbackActive: true, lastError: error instanceof Error ? error.message : String(error) };
      return fallback;
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
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" }
        })
      });

      if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
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
}

export function createMockAiProvider(options?: MockAiProviderOptions): MockAiProvider {
  return new MockAiProvider(options);
}

export function createAiProvider(config: AiProviderConfig = {}, fallback?: AiProvider): AiProvider {
  const provider = (config.provider || "mock").toLowerCase();
  if (provider === "openai-compatible" || provider === "real") {
    return new OpenAICompatibleProvider(config, fallback ?? new MockAiProvider());
  }
  return new MockAiProvider();
}

export function getAiConfigFromEnv(env: Record<string, unknown>): AiProviderConfig {
  return {
    provider: typeof env.AI_PROVIDER === "string" ? env.AI_PROVIDER as AiProviderMode : "mock",
    apiKey: typeof env.AI_API_KEY === "string" ? env.AI_API_KEY : "",
    baseUrl: typeof env.AI_BASE_URL === "string" ? env.AI_BASE_URL : "",
    model: typeof env.AI_MODEL === "string" ? env.AI_MODEL : "",
    timeoutMs: typeof env.AI_TIMEOUT_MS === "string" ? Number(env.AI_TIMEOUT_MS) : undefined
  };
}

export function getAiRuntimeStatus(config: AiProviderConfig = {}, lastCallStatus: AiCallStatus = "idle"): AiRuntimeStatus {
  const provider = config.provider || "mock";
  const realMode = provider === "openai-compatible" || provider === "real";
  return {
    mode: realMode ? "real" : "mock",
    providerName: realMode ? "OpenAICompatibleProvider" : "MockAIProvider",
    modelName: realMode ? config.model || "gpt-4.1-mini" : "local-rules",
    apiKeyConfigured: Boolean(config.apiKey),
    lastCallStatus,
    fallbackActive: !realMode || !config.apiKey
  };
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
  private status: AiRuntimeStatus = {
    mode: "mock",
    providerName: "ServerAIProxy",
    modelName: "server-runtime",
    apiKeyConfigured: false,
    lastCallStatus: "idle",
    fallbackActive: true
  };

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
    return this.callTask<ImportBatchSummary>("summarize_import_batch", batch, fallback);
  }

  async generateSearchKeywords(input: ShareInput): Promise<string[]> {
    const fallback = await Promise.resolve(this.fallback.generateSearchKeywords(input));
    const data = await this.callTask<string[]>("generate_search_keywords", input, fallback);
    return normalizeKeywordsResult(data, fallback);
  }

  private async callTask<T>(task: AiTask, payload: unknown, fallback: T): Promise<T> {
    if (typeof fetch !== "function") {
      this.markFallback("AI_PROXY_UNAVAILABLE", "Fetch is not available in this runtime");
      return fallback;
    }

    try {
      const response = await fetch(this.options.endpoint ?? "/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task, payload })
      });
      const body = (await response.json()) as AiProxyResponse<T>;

      if (!body.ok) {
        this.markFallback(body.error.code, body.error.message, body.meta);
        return fallback;
      }

      this.applyMeta(body.meta);
      return body.data;
    } catch (error) {
      this.markFallback("AI_PROXY_UNAVAILABLE", error instanceof Error ? error.message : String(error));
      return fallback;
    }
  }

  private applyMeta(meta: AiResponseMeta): void {
    this.status = {
      mode: meta.provider === "real" ? "real" : "mock",
      providerName: meta.providerName,
      modelName: meta.model,
      apiKeyConfigured: meta.apiKeyConfigured,
      lastCallStatus: meta.fallback ? "fallback" : "success",
      fallbackActive: meta.fallback,
      lastError: meta.reason
    };
    this.options.onStatusChange?.(this.status);
  }

  private markFallback(reason: AiFallbackReason | string, message: string, meta?: Partial<AiResponseMeta>): void {
    this.status = {
      mode: meta?.provider === "real" ? "real" : "mock",
      providerName: meta?.providerName ?? "ServerAIProxy",
      modelName: meta?.model ?? "mock-fallback",
      apiKeyConfigured: Boolean(meta?.apiKeyConfigured),
      lastCallStatus: "fallback",
      fallbackActive: true,
      lastError: message || reason
    };
    this.options.onStatusChange?.(this.status);
  }
}

export function createAiClient(options?: AiClientOptions): AiProvider {
  return new AiHttpClient(options);
}
function coerceClassificationResult(value: unknown, input: ShareInput): AiClassificationResult {
  const fallback = classifyAndGenerateActionCard(input);
  if (!isRecord(value)) return fallback;
  const rawActionCard = isRecord(value.actionCard) ? value.actionCard : {};
  return {
    category: isCategory(value.category) ? value.category : fallback.category,
    confidence: readConfidence(value.confidence, fallback.confidence),
    intent: readString(value.intent, fallback.intent),
    summary: readString(value.summary, fallback.summary),
    keywords: readStringArray(value.keywords, fallback.keywords),
    entities: readEntities(value.entities, fallback.entities),
    searchableText: readString(value.searchableText, fallback.searchableText),
    actionCard: {
      title: readString(rawActionCard.title, fallback.actionCard.title),
      goal: readString(rawActionCard.goal, fallback.actionCard.goal),
      nextAction: readString(rawActionCard.nextAction, fallback.actionCard.nextAction),
      estimatedTime: readString(rawActionCard.estimatedTime, fallback.actionCard.estimatedTime),
      difficulty: readString(rawActionCard.difficulty, fallback.actionCard.difficulty) as ActionCardDraft["difficulty"],
      tasks: readTasks(rawActionCard.tasks, fallback.actionCard.tasks),
      structuredFields: isRecord(rawActionCard.structuredFields) ? rawActionCard.structuredFields as Record<string, string | string[]> : fallback.actionCard.structuredFields
    }
  };
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

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return values.length > 0 ? values.slice(0, 12) : fallback;
}

function readEntities(value: unknown, fallback: EntityTag[]): EntityTag[] {
  if (!Array.isArray(value)) return fallback;
  const entities = value
    .filter(isRecord)
    .map((item) => ({ type: readString(item.type, "topic"), value: readString(item.value, "") }))
    .filter((item) => item.value);
  return entities.length > 0 ? entities.slice(0, 12) : fallback;
}

function readTasks(value: unknown, fallback: TaskDraft[]): TaskDraft[] {
  if (!Array.isArray(value)) return fallback;
  const tasks = value
    .filter(isRecord)
    .map((item) => ({
      title: readString(item.title, "下一步行动"),
      description: readString(item.description, "从一个 5-30 分钟的小动作开始"),
      estimatedTime: readString(item.estimatedTime, "20分钟"),
      dueDate: typeof item.dueDate === "string" ? item.dueDate : undefined
    }));
  return tasks.length > 0 ? tasks.slice(0, 8) : fallback;
}

export async function classifyAndGenerateActionCardAsync(input: ShareInput): Promise<AiClassificationResult> {
  return classifyAndGenerateActionCard(input);
}

export function classifyAndGenerateActionCard(input: ShareInput): AiClassificationResult {
  const text = combineInput(input);
  const inference = inferCategoryWithConfidence(text, input);
  const category = inference.category;
  const rule = categoryRules.find((item) => item.category === category);
  const baseIntent = rule?.intent ?? "用户可能想保留这条内容，并在合适的时候重新查看或实践";
  const intent = inference.confidence === "low" ? `${baseIntent}；信息较少，按最可能用途归类。` : baseIntent;
  const entities = extractEntities(text, category);
  const keywords = extractKeywords(text, category, entities);
  const summary = buildSummary(input, category, keywords, inference.confidence);
  const actionCard = generateActionCard(category, input, keywords, entities);
  const searchableText = buildSearchableText(input, category, intent, summary, keywords, entities, actionCard);

  return {
    category,
    confidence: inference.confidence,
    intent,
    summary,
    keywords,
    entities,
    searchableText,
    actionCard
  };
}
function combineInput(input: ShareInput): string {
  const extended = input as ShareInput & { visibleText?: string; keywords?: string[] };
  return [
    input.title,
    input.rawShareText,
    extended.visibleText,
    input.userNote,
    Array.isArray(extended.keywords) ? extended.keywords.join(" ") : "",
    input.sourceUrl
  ]
    .filter(Boolean)
    .join(" ");
}

function inferCategory(text: string): Category {
  return inferCategoryWithConfidence(text, { sourceUrl: "", title: text, rawShareText: "", userNote: "" }).category;
}

function inferCategoryWithConfidence(text: string, input: ShareInput): { category: Category; confidence: AiClassificationResult["confidence"]; score: number } {
  const weightedText = [
    input.title,
    input.title,
    input.rawShareText,
    input.rawShareText,
    input.userNote,
    input.userNote,
    text
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();

  const signalText = [input.title, input.rawShareText, input.userNote].filter(Boolean).join(" ").trim();
  if (signalText.length < 2 && !text.trim()) {
    return { category: "其他", confidence: "low", score: 0 };
  }

  const scores = categoryRules.map((rule) => {
    const score = rule.terms.reduce((total, term) => {
      const normalized = term.toLocaleLowerCase();
      if (!normalized) return total;
      if (!weightedText.includes(normalized)) return total;
      const weight = Math.max(2, Math.min(8, normalized.length));
      const titleBoost = input.title.toLocaleLowerCase().includes(normalized) ? 4 : 0;
      const noteBoost = input.userNote.toLocaleLowerCase().includes(normalized) ? 3 : 0;
      return total + weight + titleBoost + noteBoost;
    }, 0);
    return { category: rule.category, score };
  });

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score <= 0) {
    const fallback = signalText.length >= 6 ? "生活方式" : "其他";
    return { category: fallback, confidence: "low", score: 0 };
  }

  const runnerUp = scores[1]?.score ?? 0;
  const confidence: AiClassificationResult["confidence"] = best.score >= 14 && best.score >= runnerUp + 4 ? "high" : best.score >= 6 ? "medium" : "low";
  return { category: best.category, confidence, score: best.score };
}
function extractEntities(text: string, category: Category): EntityTag[] {
  const primaryType = categoryEntityTypes[category];
  const values = new Set<string>();
  const hints = entityHints[primaryType] ?? [];

  hints.forEach((hint) => {
    if (text.toLocaleLowerCase().includes(hint.toLocaleLowerCase())) {
      values.add(hint);
    }
  });

  const quoted = text.match(/[「“《#]([^」”》#]{2,18})[」”》#]/g) ?? [];
  quoted
    .map((item) => item.replace(/[「」“”《》#]/g, "").trim())
    .filter(Boolean)
    .slice(0, 4)
    .forEach((item) => values.add(item));

  return Array.from(values)
    .slice(0, 8)
    .map((value) => ({ type: primaryType, value }));
}

function extractKeywords(text: string, category: Category, entities: EntityTag[]): string[] {
  const keywords = new Set<string>();
  const rule = categoryRules.find((item) => item.category === category);

  rule?.terms.forEach((term) => {
    if (text.toLocaleLowerCase().includes(term.toLocaleLowerCase())) {
      keywords.add(term);
    }
  });

  entities.forEach((entity) => keywords.add(entity.value));

  text
    .split(/[\s,，。.!！?？、|/\\:：;；《》「」“”()[\]【】]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 14)
    .filter((part) => !/^https?:/i.test(part))
    .slice(0, 12)
    .forEach((part) => keywords.add(part));

  if (keywords.size === 0) {
    keywords.add(category);
  }

  return Array.from(keywords).slice(0, 10);
}

function buildSummary(input: ShareInput, category: Category, keywords: string[], confidence: AiClassificationResult["confidence"] = "medium"): string {
  const topic = cleanTitle(input.title || input.rawShareText) || "这条收藏";
  const keywordText = keywords.slice(0, 3).join("、") || category;
  const confidenceHint = confidence === "low" ? "信息较少，先按最可能用途整理；" : "";
  return `${confidenceHint}${topic} 可能和${keywordText}有关，适合被整理成一张可执行的${category}行动卡。`;
}

function cleanTitle(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
}

function generateActionCard(category: Category, input: ShareInput, keywords: string[], entities: EntityTag[]): ActionCardDraft {
  const topic = pickTopic(input, keywords, entities, category);
  const lead = entities[0]?.value || keywords[0] || topic;

  if (isLowInformationInput(input)) {
    return card(
      buildCardTitle(topic, "补全信息卡"),
      "先补齐这条收藏的主题和使用场景，再重新生成更准确的行动卡",
      "打开原帖，补充标题、地点、工具名或材料名，再写一句你为什么收藏它。",
      "8分钟",
      "低",
      [
        task("补标题或关键词", "打开原帖，只补充能帮助识别主题的标题、地点、工具名或材料名", "3分钟"),
        task("写一句收藏原因", "用自己的话写：我想学、想去、想买、想做，还是想拿来创作", "3分钟"),
        task("重新生成行动卡", "补完信息后再点重新生成，让分类和下一步更贴近原帖", "2分钟")
      ],
      {
        内容摘要: "当前只有很少分享信息，先把它当成待补全收藏处理。",
        可能的收藏原因: "信息不足，暂按最可能用途保留。",
        下一步行动: "补充一句你为什么收藏它。",
        "打开原帖后重点看什么": ["原帖标题", "地点/工具/材料名", "作者给的步骤", "你当时想保存的原因"],
        产出物: "一条更清楚的备注，方便重新分类"
      }
    );
  }

  const contentCategories: Category[] = ["内容创作", "小红书运营", "灵感素材"];
  const aiSkillCategories: Category[] = ["AI工具", "技能学习", "工作效率", "职场学习"];
  const travelCategories: Category[] = ["旅行地点", "美食探店", "生活方式"];
  const emotionCategories: Category[] = ["情绪成长", "亲密关系"];
  const styleShoppingCategories: Category[] = ["穿搭变美", "购物参考"];
  const homeCategories: Category[] = ["家居生活"];
  const fitnessBookCategories: Category[] = ["健身运动", "读书学习"];

  if (contentCategories.includes(category)) {
    return card(
      buildCardTitle(topic, "创作行动卡"),
      `把${topic}转成一个可以发布或收藏进选题库的创作结构`,
      `打开原帖，只记录标题结构、封面构图、开头钩子和评论区高频问题，然后改写成 1 个适合你账号方向的选题。`,
      "20分钟",
      "低",
      [
        task("提取四个创作要素", "记录标题结构、封面构图、开头钩子、评论区高频问题，不复制原帖完整内容", "8分钟"),
        task("改写一个选题", `把${lead}换成你的账号方向，写出 1 条可发布选题`, "7分钟"),
        task("写开头文案", "写 50-100 字开头，明确读者痛点和承诺", "5分钟")
      ],
      {
        核心灵感: topic,
        关键词: keywords.slice(0, 6),
        可复用结构: "标题钩子 -> 封面视觉 -> 开头痛点 -> 评论区问题补充",
        可改写方向: ["选题标题", "封面结构", "开头文案", "评论区答疑角度"],
        适合的平台: category === "小红书运营" ? "小红书图文/短视频" : "小红书、公众号、短视频脚本",
        可生成的选题: [`${lead}避坑清单`, `${lead}新手入门`, `${lead}真实复盘`],
        下一步创作动作: "产出 1 条可发布选题、1 个封面结构或 1 段开头文案",
        "打开原帖后重点看什么": ["标题结构", "封面构图", "开头钩子", "评论区高频问题"]
      }
    );
  }

  if (aiSkillCategories.includes(category)) {
    return card(
      buildCardTitle(topic, category === "AI工具" ? "复现卡" : "练习卡"),
      `复现${lead}里最小的一步，产出一个能保存的小结果`,
      `打开原帖，找到工具名和第一个操作步骤；今天只复现第一个案例，并保存截图、prompt 或一个小作品。`,
      "25分钟",
      "中",
      [
        task("确认工具和入口", "打开原帖，只找工具名、网址或第一个操作入口", "5分钟"),
        task("复现第一个案例", "按原帖的第一个步骤做一遍，不扩展到完整流程", "15分钟"),
        task("保存产出物", "保存一张截图、一个 prompt、一个表格模板或一个小作品", "5分钟")
      ],
      {
        学习目标: `掌握${lead}的第一个可复现动作`,
        适合人群: "想先试一次，而不是先收藏一整套教程的人",
        第一步行动: "只复现第一个案例",
        练习任务: ["找工具名", "做第一个步骤", "保存产出物"],
        预计耗时: "15-30分钟",
        完成标准: "产出一张截图、一个 prompt、一个小作品或一个可复用 SOP",
        "打开原帖后重点看什么": ["工具名/材料名", "第一个操作步骤", "示例输入", "作者给的注意事项"]
      }
    );
  }

  if (travelCategories.includes(category)) {
    return card(
      buildCardTitle(topic, category === "美食探店" ? "探店候选卡" : "周末计划卡"),
      `判断${lead}是否值得进入近期周末或出行候选清单`,
      `打开原帖，确认地点、营业时间/开放时间、交通和预算，再给它添加一个候选日期。`,
      "15分钟",
      "低",
      [
        task("核对基础信息", "确认地点、营业时间或开放时间、交通方式和大致预算", "8分钟"),
        task("选候选日期", "给它放进一个具体周末、下班后或假期时间窗口", "4分钟"),
        task("写半日草稿", "只写出出发时间、主地点、附近一个备选点", "3分钟")
      ],
      {
        地点名称: lead,
        推荐游玩时长: category === "美食探店" ? "1-2小时" : "半天到1天",
        交通建议: "优先确认是否顺路、停车或地铁是否方便",
        预算区间: "按门票/人均/交通分别估算",
        路线安排: ["确认主地点", "加一个候选日期", "补一个附近备选点"],
        避坑提醒: "出发前回到原帖核对最新时间、价格和预约要求",
        适合人群: "想把心动地点变成真实周末计划的人",
        可加入的旅行计划: "周末计划草稿",
        "打开原帖后重点看什么": ["地点/店名", "营业或开放时间", "交通方式", "价格/预约要求"]
      }
    );
  }

  if (category === "菜谱做饭") {
    return card(
      buildCardTitle(topic, "备餐卡"),
      `把${lead}变成一次能下厨的购物清单和复刻步骤`,
      `打开原帖，抄下食材清单，并把每样标成“家里已有/需要购买”，最后生成一张购物清单。`,
      "20分钟",
      "中",
      [
        task("抄食材清单", "只记录主食材、关键调味料和可替代食材", "7分钟"),
        task("标记已有和缺少", "把食材分成家里已有、需要购买、可以替代三类", "8分钟"),
        task("安排一次复刻", "选择今天晚餐、明天早餐或周末备餐其中一个时间", "5分钟")
      ],
      {
        菜名: lead,
        食材清单: ["主食材", "关键调味料", "可替代食材"],
        制作步骤: ["抄食材", "标记已有/缺少", "安排复刻时间"],
        准备时间: "10分钟",
        烹饪时间: "20-30分钟",
        可替代食材: ["同类蔬菜", "低脂蛋白", "家里已有调味料"],
        购物清单: ["需要购买的主食材", "缺少的调味料"],
        难度等级: "中",
        适合场景: "工作日晚餐、低卡备餐或周末下厨",
        "打开原帖后重点看什么": ["食材清单", "调味比例", "关键步骤", "评论区替代做法"]
      }
    );
  }

  if (emotionCategories.includes(category)) {
    return card(
      buildCardTitle(topic, "自我观察卡"),
      `把${lead}里触动你的观点转成一条可复盘的自我观察`,
      `打开原帖，摘出一句最触动你的观点，写一个自己的例子，并判断它适合放进手帐、复盘还是待办。`,
      "15分钟",
      "低",
      [
        task("摘一句观点", "只摘最触动你的 1 句话，不复制长段内容", "4分钟"),
        task("写一个自己的例子", "写下最近一次类似场景：发生了什么、你怎么反应", "8分钟"),
        task("决定归档位置", "选择手帐、复盘、待办或只保存", "3分钟")
      ],
      {
        内容摘要: topic,
        可能的收藏原因: "这条内容可能触发了关系、情绪或表达上的自我观察",
        可以如何使用: "作为手帐/复盘素材，而不是立刻变成任务压力",
        下一步行动: "写一条自我观察记录",
        相关关键词: keywords.slice(0, 6),
        产出物: "一条自我观察记录",
        "打开原帖后重点看什么": ["最触动你的观点", "适用场景", "作者给的表达句式", "评论区补充经验"]
      }
    );
  }

  if (styleShoppingCategories.includes(category)) {
    return card(
      buildCardTitle(topic, category === "购物参考" ? "理性种草卡" : "今日小改变"),
      `把${lead}从冲动收藏变成一次低成本试用或购买判断`,
      `打开原帖，提取风格关键词和核心单品；先检查自己是否已有类似单品，再列一个低成本替代清单。`,
      "15分钟",
      "低",
      [
        task("提取风格关键词", "记录颜色、版型、材质、使用场景或妆发重点", "5分钟"),
        task("检查已有替代", "在衣柜、化妆包或购物车里找相似物，不立刻下单", "6分钟"),
        task("列替代清单", "写 1-3 个已有替代或低成本替代方案", "4分钟")
      ],
      {
        风格关键词: keywords.slice(0, 5),
        适合场景: "日常、通勤、拍照、约会或换季购物",
        单品清单: ["核心单品", "已有相似物", "可低成本替代物"],
        操作步骤: ["提取关键词", "检查已有", "列替代清单"],
        低成本替代方案: "优先用已有物品模拟效果，再决定是否购买",
        注意事项: "不要因为收藏冲动立刻整套下单",
        今日可执行小改变: "只替换一个单品、一个配色或一个妆发细节",
        "打开原帖后重点看什么": ["风格关键词", "核心单品", "价格/品牌", "替代方案"]
      }
    );
  }

  if (homeCategories.includes(category)) {
    return card(
      buildCardTitle(topic, "30分钟整理卡"),
      `把${lead}缩小成一个不超过 1 平米的家居行动`,
      `先选一个不超过 1 平米的小区域，列出需要移动、丢掉、购买的东西，今天只完成这一个区域。`,
      "30分钟",
      "中",
      [
        task("选最小区域", "只选桌面、衣柜一层、厨房台面或床头柜，不扩大范围", "3分钟"),
        task("三栏清单", "列出需要移动、丢掉、购买的东西", "7分钟"),
        task("完成一次整理", "计时 20 分钟，只处理这个小区域", "20分钟")
      ],
      {
        改造目标: `完成${lead}相关的最小区域整理`,
        采购清单: ["先不买", "确实缺少的收纳件", "清洁用品"],
        操作步骤: ["选区域", "列移动/丢掉/购买", "计时整理"],
        预算区间: "0-200元，优先利用已有物品",
        难度等级: "中",
        注意事项: "不要一开始就全屋改造",
        周末执行计划: ["周五列清单", "周六整理 30 分钟", "周日决定是否购买"],
        "打开原帖后重点看什么": ["改造前后对比", "尺寸/材料", "购买清单", "评论区避坑"]
      }
    );
  }

  if (fitnessBookCategories.includes(category)) {
    return card(
      buildCardTitle(topic, category === "健身运动" ? "低门槛训练卡" : "阅读学习卡"),
      `把${lead}变成今天可以完成的一次小练习或阅读产出`,
      category === "健身运动"
        ? `打开原帖，确认第一个动作的姿势要点；今天只做 1 组，并记录身体感受。`
        : `打开原帖，选一个最想理解的观点；今天只读/看 10 分钟，并写 3 句话笔记。`,
      "15分钟",
      "低",
      category === "健身运动"
        ? [
            task("确认一个动作", "只找第一个动作的姿势要点和注意事项", "5分钟"),
            task("完成一组", "做 1 组或 10 分钟，不追求完整训练", "10分钟"),
            task("记录身体感受", "写下哪里紧、哪里累、下次是否继续", "3分钟")
          ]
        : [
            task("选一个观点", "只选一个最想理解的观点或书单条目", "3分钟"),
            task("读 10 分钟", "计时阅读，不延伸找资料", "10分钟"),
            task("写三句话", "写观点、自己的例子、下一步问题", "5分钟")
          ],
      {
        内容摘要: topic,
        下一步行动: category === "健身运动" ? "完成 1 组低门槛训练" : "写 3 句话学习笔记",
        相关关键词: keywords.slice(0, 6),
        产出物: category === "健身运动" ? "一条训练感受记录" : "三句话读书/学习笔记",
        "打开原帖后重点看什么": category === "健身运动" ? ["动作要点", "注意事项", "组数/时长", "评论区纠错"] : ["核心观点", "书名/章节", "作者给的例子", "可继续追问的问题"]
      }
    );
  }

  return card(
    buildCardTitle(topic, "补全信息卡"),
    "判断这条收藏之后如何使用，并补足最关键的一句背景",
    "打开原帖，确认它到底是想学、想去、想买、想做还是想拿来创作，然后补一句收藏原因。",
    "10分钟",
    "低",
    [
      task("确认用途", "从想学、想去、想买、想做、想创作里选一个", "3分钟"),
      task("补一句备注", "写下当初为什么想收藏它", "4分钟"),
      task("重新生成", "补完后重新生成行动卡", "3分钟")
    ],
    {
      内容摘要: buildSummary(input, "其他", keywords, "low"),
      可能的收藏原因: "有参考价值，但当前分享信息不足以判断具体执行场景",
      可以如何使用: "作为待整理线索，之后通过关键词找回原帖",
      下一步行动: "补充备注或重新生成行动卡",
      相关关键词: keywords,
      是否建议重新分类: "建议补充一句备注后重新生成",
      "打开原帖后重点看什么": ["原帖标题", "作者给的步骤", "地点/时间/价格", "工具名/材料名"]
    }
  );
}

function pickTopic(input: ShareInput, keywords: string[], entities: EntityTag[], category: Category): string {
  const title = sanitizeBaseTitle(input.title || input.rawShareText || input.userNote);
  if (title) return title;
  return entities[0]?.value || keywords.find((item) => item !== category) || category;
}

function sanitizeBaseTitle(value: string): string {
  return cleanTitle(value)
    .replace(/行动卡/g, "")
    .replace(/复刻卡/g, "")
    .replace(/补全信息卡/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28);
}

function buildCardTitle(topic: string, suffix: string): string {
  const base = sanitizeBaseTitle(topic) || "这条收藏";
  const normalizedSuffix = suffix.replace(/^行动卡$/, "行动卡");
  return `${base}${normalizedSuffix}`.replace(/行动卡行动卡/g, "行动卡").replace(/卡卡/g, "卡");
}

function isLowInformationInput(input: ShareInput): boolean {
  const signal = [input.title, input.rawShareText, input.userNote]
    .filter(Boolean)
    .join(" ")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
  return signal.length < 6;
}
function card(
  title: string,
  goal: string,
  nextAction: string,
  estimatedTime: string,
  difficulty: "低" | "中" | "高",
  tasks: TaskDraft[],
  structuredFields: Record<string, string | string[]>
): ActionCardDraft {
  return {
    title,
    goal,
    nextAction,
    estimatedTime,
    difficulty,
    tasks,
    structuredFields
  };
}

function task(title: string, description: string, estimatedTime: string): TaskDraft {
  return { title, description, estimatedTime };
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
  const taskText = actionCard.tasks.map((item) => `${item.title} ${item.description}`).join(" ");
  const entityText = entities.map((item) => `${item.type}:${item.value}`).join(" ");

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
