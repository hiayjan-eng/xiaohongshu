declare const process: { env: Record<string, string | undefined> };
type FetchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};
declare const fetch: (input: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => {
    json: (body: unknown) => void;
  };
  setHeader?: (name: string, value: string) => void;
};

type AiTask =
  | "classify_action_card"
  | "generate_smart_albums"
  | "regenerate_action_card"
  | "summarize_import_batch"
  | "generate_search_keywords";

type AiRequestBody = {
  task?: unknown;
  payload?: unknown;
};

type AiConfig = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

type AiMeta = {
  provider: "mock" | "real";
  providerName: string;
  model: string;
  fallback: boolean;
  reason?: string;
  apiKeyConfigured: boolean;
};

const MAX_PAYLOAD_BYTES = 80_000;

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader?.("content-type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return send(res, 405, {
      ok: false,
      error: { code: "AI_METHOD_NOT_ALLOWED", message: "Only POST is supported for /api/ai." }
    });
  }

  const body = parseBody(req.body);
  const bodySize = JSON.stringify(body).length;
  if (bodySize > MAX_PAYLOAD_BYTES) {
    return send(res, 413, {
      ok: false,
      error: { code: "AI_PAYLOAD_TOO_LARGE", message: "AI request payload is too large. Try importing fewer items at once." }
    });
  }

  if (!isAiTask(body.task)) {
    return send(res, 400, {
      ok: false,
      error: { code: "AI_BAD_REQUEST", message: "Unsupported or missing AI task." }
    });
  }

  const config = getAiConfigFromEnv(process.env);
  const wantsRealProvider = config.provider === "openai-compatible" || config.provider === "real";

  if (!wantsRealProvider) {
    return sendMockFallback(res, body.task, body.payload, "MOCK_PROVIDER_SELECTED", false);
  }

  if (!config.apiKey) {
    return sendMockFallback(res, body.task, body.payload, "AI_KEY_MISSING", false);
  }

  try {
    const data = await executeRealProviderTask(config, body.task, body.payload);
    return send(res, 200, {
      ok: true,
      data,
      meta: {
        provider: "real",
        providerName: "OpenAICompatibleProvider",
        model: config.model,
        fallback: false,
        apiKeyConfigured: true
      } satisfies AiMeta
    });
  } catch (error) {
    return send(res, 500, {
      ok: false,
      error: { code: "AI_INTERNAL_ERROR", message: "AI request failed and was not completed." },
      meta: {
        provider: "real",
        providerName: "OpenAICompatibleProvider",
        model: config.model,
        fallback: true,
        reason: error instanceof Error ? error.message : "AI_API_ERROR",
        apiKeyConfigured: true
      } satisfies AiMeta
    });
  }
}

async function sendMockFallback(res: ApiResponse, task: AiTask, payload: unknown, reason: string, apiKeyConfigured: boolean): Promise<void> {
  const data = await executeMockTask(task, payload);
  return send(res, 200, {
    ok: true,
    data,
    meta: {
      provider: "mock",
      providerName: "MockAIProvider",
      model: "local-rules",
      fallback: true,
      reason,
      apiKeyConfigured
    } satisfies AiMeta
  });
}

async function executeRealProviderTask(config: AiConfig, task: AiTask, payload: unknown): Promise<unknown> {
  const fallback = await executeMockTask(task, payload);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are a private collection revival assistant. Return strict JSON only. Never copy full original posts."
        },
        {
          role: "user",
          content: buildProviderPrompt(task, payload, fallback)
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`AI_API_ERROR_${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`);
  }

  const raw = await response.json();
  const content = readString((raw as any)?.choices?.[0]?.message?.content);
  return extractJson(content) ?? fallback;
}
async function executeMockTask(task: AiTask, payload: unknown): Promise<unknown> {
  switch (task) {
    case "classify_action_card":
      return buildMockClassification(normalizeShareInput(payload));
    case "generate_smart_albums":
      return buildMockAlbums(normalizeSmartAlbumInput(payload).savedItems);
    case "regenerate_action_card": {
      const record = isRecord(payload) ? payload : {};
      const input = normalizeShareInput(record.savedItem ?? record);
      return buildMockClassification(input).actionCard;
    }
    case "summarize_import_batch": {
      const batch = isRecord(payload) ? payload : {};
      return {
        title: readString(batch.title) || "Import batch",
        summary: `Imported ${readNumber(batch.importedCount)} of ${readNumber(batch.rawCount)} items with ${readNumber(batch.failedCount)} failures.`,
        recommendedNextStep: readNumber(batch.importedCount) > 0 ? "Open smart albums and pick three items to revive first." : "Fix failed items before continuing.",
        fallbackUsed: true
      };
    }
    case "generate_search_keywords":
      return buildKeywords(normalizeShareInput(payload));
  }
}

function buildProviderPrompt(task: AiTask, payload: unknown, fallback: unknown): string {
  return [
    "Task: " + task,
    "Return strict JSON matching the fallback shape. Make action steps concrete, private, and 5-30 minutes long.",
    "Input:",
    JSON.stringify(payload),
    "Fallback shape:",
    JSON.stringify(fallback)
  ].join("\n");
}

function extractJson(value: string): unknown {
  if (!value) return undefined;
  const cleaned = value.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  for (const candidate of [cleaned, sliceJson(cleaned, "{", "}"), sliceJson(cleaned, "[", "]")]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next possible JSON slice.
    }
  }
  return undefined;
}

function sliceJson(value: string, startToken: "{" | "[", endToken: "}" | "]"): string {
  const start = value.indexOf(startToken);
  const end = value.lastIndexOf(endToken);
  return start >= 0 && end > start ? value.slice(start, end + 1) : "";
}
function buildMockClassification(input: ReturnType<typeof normalizeShareInput>) {
  const text = [input.title, input.rawShareText, input.userNote, input.sourceUrl].filter(Boolean).join(" ");
  const category = inferCategory(text);
  const keywords = buildKeywords(input);
  const topic = cleanTitle(input.title || input.rawShareText || input.userNote || keywords[0] || "这条收藏");
  const nextAction = buildNextAction(category, topic);
  const actionCard = {
    title: `${topic}${category === "其他" ? "补全信息卡" : "行动卡"}`.replace(/行动卡行动卡/g, "行动卡"),
    goal: `把“${topic}”转成一个今天能开始的小动作`,
    nextAction,
    estimatedTime: category === "家居生活" ? "30分钟" : "20分钟",
    difficulty: "低",
    tasks: [
      { title: "打开原帖", description: nextAction, estimatedTime: "10分钟" },
      { title: "留下产出", description: "把这次行动的产出写成一句话、一个清单或一个草稿。", estimatedTime: "10分钟" }
    ],
    structuredFields: {
      "打开原帖后重点看什么": focusPointsForCategory(category),
      "产出物": outputForCategory(category)
    }
  };

  return {
    category,
    confidence: text.replace(/https?:\/\/\S+/g, "").trim().length >= 8 ? "medium" : "low",
    intent: category === "其他" ? "信息不足，按最可能用途归类为待补充收藏" : `用户可能想把这条${category}收藏转成可执行动作`,
    summary: `${topic} 可能和 ${keywords.slice(0, 3).join("、") || category} 有关，适合整理成一张私人行动卡。`,
    keywords,
    entities: keywords.slice(0, 5).map((value) => ({ type: entityTypeForCategory(category), value })),
    searchableText: [input.sourceUrl, input.title, input.rawShareText, input.userNote, category, keywords.join(" "), actionCard.title, actionCard.nextAction].filter(Boolean).join(" "),
    actionCard
  };
}

function buildMockAlbums(savedItems: any[]): unknown[] {
  const groups = new Map<string, any[]>();
  for (const item of Array.isArray(savedItems) ? savedItems : []) {
    const category = readString(item?.category) || "其他";
    groups.set(category, [...(groups.get(category) ?? []), item]);
  }
  return Array.from(groups.entries()).slice(0, 8).map(([category, items], index) => ({
    id: `album_api_fallback_${index + 1}`,
    title: albumTitleForCategory(category),
    description: `从已确认导入的 ${items.length} 条${category}收藏里，先挑 3 条最容易开始的复活。`,
    category,
    keywords: unique(items.flatMap((item) => Array.isArray(item.keywords) ? item.keywords : []).slice(0, 8)),
    savedItemIds: items.map((item) => item.id).filter(Boolean),
    coverItemId: items[0]?.id ?? "",
    priority: 70 - index,
    status: "candidate",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));
}

function buildKeywords(input: ReturnType<typeof normalizeShareInput>): string[] {
  const text = [input.title, input.rawShareText, input.userNote].join(" ");
  const candidates = [
    "小红书", "封面", "标题", "选题", "AI工具", "工作流", "剪辑", "大理", "深圳", "周末", "展览", "咖啡", "低卡", "晚餐", "备餐", "收纳", "关系", "表达需求", "穿搭", "购物", "读书"
  ];
  const hits = candidates.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  const words = text.split(/[\s,，。；;、/|]+/).map((word) => word.trim()).filter((word) => word.length >= 2 && word.length <= 16);
  return unique([...hits, ...words]).slice(0, 12);
}

function inferCategory(text: string): string {
  const rules: Array<[string, string[]]> = [
    ["小红书运营", ["小红书", "封面", "标题", "笔记", "账号运营", "图文排版", "涨粉"]],
    ["AI工具", ["AI工具", "AI 工具", "ChatGPT", "Claude", "prompt", "提示词", "工作流"]],
    ["旅行地点", ["旅行", "攻略", "路线", "大理", "深圳", "周末", "展览", "徒步", "城市"]],
    ["美食探店", ["探店", "咖啡", "餐厅", "甜品", "夜市", "小吃", "人均"]],
    ["菜谱做饭", ["菜谱", "做饭", "低卡", "晚餐", "备餐", "早餐", "食材", "减脂餐"]],
    ["情绪成长", ["情绪", "内耗", "焦虑", "自我成长", "复盘"]],
    ["亲密关系", ["亲密关系", "关系", "表达需求", "伴侣", "恋爱", "边界"]],
    ["穿搭变美", ["穿搭", "妆容", "发型", "护肤", "风格", "变美"]],
    ["购物参考", ["购物", "种草", "平替", "测评", "购买", "单品"]],
    ["家居生活", ["收纳", "家居", "改造", "清洁", "租房", "整理"]],
    ["技能学习", ["教程", "学习", "剪辑", "摄影", "英语", "写作", "编程", "设计"]],
    ["内容创作", ["选题", "文案", "拍摄", "脚本", "素材", "创作", "排版"]],
    ["工作效率", ["效率", "SOP", "自动化", "办公", "Notion", "Excel", "飞书"]]
  ];
  const normalized = text.toLowerCase();
  return rules.find(([, terms]) => terms.some((term) => normalized.includes(term.toLowerCase())))?.[0] ?? "生活方式";
}

function buildNextAction(category: string, topic: string): string {
  if (category === "小红书运营" || category === "内容创作") return `打开原帖，只记录“${topic}”的标题结构、封面构图和开头钩子，然后改写成 1 个适合你账号方向的选题。`;
  if (category === "AI工具" || category === "技能学习" || category === "工作效率") return `打开原帖，找到第一个工具名或操作步骤，今天只复现第一步，并留下 1 张截图或 1 段可复用 prompt。`;
  if (category === "旅行地点" || category === "美食探店" || category === "生活方式") return `打开原帖，确认地点、时间、交通和预算，把它放进一个候选日期，产出 1 个周末计划草稿。`;
  if (category === "菜谱做饭") return `打开原帖，抄下食材清单，标记家里已有和需要购买的材料，产出 1 张购物清单。`;
  if (category === "情绪成长" || category === "亲密关系") return `打开原帖，摘出 1 句最触动你的观点，再写 1 个自己的例子，产出 1 条自我观察记录。`;
  if (category === "穿搭变美" || category === "购物参考") return `打开原帖，提取风格关键词和核心单品，检查自己是否已有类似物，产出 1 个低成本替代清单。`;
  if (category === "家居生活") return `打开原帖，选一个不超过 1 平米的小区域，列出要移动、丢掉、购买的东西，产出 1 个 30 分钟整理任务。`;
  return `打开原帖，补充标题、地点或工具名，再写一句你为什么收藏它，产出 1 条可重新生成行动卡的备注。`;
}

function focusPointsForCategory(category: string): string[] {
  if (category === "旅行地点" || category === "美食探店") return ["地点/时间/价格", "交通方式", "评论区补充"];
  if (category === "菜谱做饭") return ["食材清单", "作者给的步骤", "替代材料"];
  if (category === "AI工具" || category === "技能学习" || category === "工作效率") return ["工具名", "第一个操作步骤", "示例产出"];
  if (category === "小红书运营" || category === "内容创作") return ["原帖标题", "封面构图", "开头钩子", "评论区高频问题"];
  return ["原帖标题", "作者给的步骤", "你当初收藏它的原因"];
}

function outputForCategory(category: string): string {
  if (category === "菜谱做饭") return "一张购物清单";
  if (category === "旅行地点" || category === "美食探店") return "一个周末计划草稿";
  if (category === "小红书运营" || category === "内容创作") return "一条可发布选题";
  if (category === "AI工具" || category === "技能学习" || category === "工作效率") return "一张截图、一个 prompt 或一个小作品";
  if (category === "情绪成长" || category === "亲密关系") return "一条自我观察记录";
  if (category === "家居生活") return "一个 30 分钟整理任务";
  return "一条补充备注";
}

function entityTypeForCategory(category: string): string {
  const map: Record<string, string> = {
    小红书运营: "creative",
    内容创作: "creative",
    AI工具: "tool",
    技能学习: "skill",
    工作效率: "tool",
    旅行地点: "place",
    美食探店: "shop",
    菜谱做饭: "dish",
    情绪成长: "emotion",
    亲密关系: "relationship",
    穿搭变美: "style",
    购物参考: "product",
    家居生活: "home"
  };
  return map[category] ?? "topic";
}

function albumTitleForCategory(category: string): string {
  const titles: Record<string, string> = {
    小红书运营: "小红书图文创作灵感",
    内容创作: "内容创作灵感清单",
    AI工具: "AI 工具学习清单",
    旅行地点: "想去的城市和路线",
    美食探店: "周末探店候选",
    菜谱做饭: "低卡晚餐和备餐",
    家居生活: "租房改造计划"
  };
  return titles[category] ?? `${category}收藏专辑`;
}

function getAiConfigFromEnv(env: Record<string, string | undefined>): AiConfig {
  return {
    provider: (env.AI_PROVIDER || "mock").toLowerCase(),
    apiKey: env.AI_API_KEY || "",
    baseUrl: (env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: env.AI_MODEL || "gpt-4.1-mini",
    timeoutMs: Number(env.AI_TIMEOUT_MS || 30000)
  };
}

function parseBody(body: unknown): AiRequestBody {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as AiRequestBody;
    } catch {
      return {};
    }
  }
  return isRecord(body) ? body : {};
}

function normalizeShareInput(value: unknown) {
  const record = isRecord(value) ? value : {};
  return {
    sourceUrl: readString(record.sourceUrl),
    title: readString(record.title),
    rawShareText: readString(record.rawShareText),
    userNote: readString(record.userNote)
  };
}

function normalizeSmartAlbumInput(value: unknown) {
  const record = isRecord(value) ? value : {};
  return {
    savedItems: Array.isArray(record.savedItems) ? record.savedItems : [],
    existingAlbums: Array.isArray(record.existingAlbums) ? record.existingAlbums : [],
    now: typeof record.now === "string" ? new Date(record.now) : new Date()
  };
}

function isAiTask(value: unknown): value is AiTask {
  return (
    value === "classify_action_card" ||
    value === "generate_smart_albums" ||
    value === "regenerate_action_card" ||
    value === "summarize_import_batch" ||
    value === "generate_search_keywords"
  );
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function cleanTitle(value: string): string {
  return value.replace(/https?:\/\/\S+/g, "").replace(/行动卡/g, "").replace(/\s+/g, " ").trim().slice(0, 32) || "这条收藏";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function send(res: ApiResponse, status: number, body: unknown): void {
  res.status(status).json(body);
}
