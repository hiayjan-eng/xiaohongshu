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
  const inferred = inferCategory(text);
  const keywords = buildKeywords(input, inferred.category, inferred.subCategory);
  const topic = cleanTitle(input.title || input.rawShareText || input.userNote || keywords[0] || "这条收藏");
  const nextAction = buildNextAction(inferred.category, topic);
  const focus = focusPointsForCategory(inferred.category);
  const output = outputForCategory(inferred.category);
  const low = text.replace(/https?:\/\/\S+/g, "").trim().length < 8 || inferred.category === "暂存";
  const actionCard = {
    title: `${topic}｜${inferred.category === "暂存" ? "补全信息卡" : "行动卡"}`.replace(/行动卡行动卡/g, "行动卡").replace(/卡卡/g, "卡"),
    goal: inferred.category === "暂存" ? "先判断这条收藏之后到底要如何使用" : `把“${topic}”转成一个今天能开始的小动作`,
    whySaved: inferred.intent,
    nextAction,
    openOriginalFocus: focus,
    output,
    estimatedTime: inferred.category === "生活与家居" ? "30分钟" : "20分钟",
    difficulty: "低",
    doneCriteria: `完成后应该得到：${output}`,
    avoidDoing: "不要一次整理太多收藏，也不要复制原帖内容。",
    ifInfoMissing: "如果信息不足，先补一句你为什么收藏它，再重新生成。",
    followUp: "完成第一步后，再决定是否加入今日复活或智能专辑。",
    tasks: [
      { title: "打开原帖看重点", description: `${nextAction} 重点看：${focus.join("、")}`, estimatedTime: "10分钟" },
      { title: "留下产出", description: `把这次行动的产出保存为：${output}`, estimatedTime: "10分钟" }
    ],
    structuredFields: { "打开原帖后重点看什么": focus, "产出物": output, "二级分类": inferred.subCategory }
  };
  return {
    category: inferred.category,
    subCategory: inferred.subCategory,
    confidence: low ? "low" : "medium",
    intent: inferred.intent,
    whyThisCategory: inferred.whyThisCategory,
    summary: low ? `这条收藏信息偏少，先按“${inferred.subCategory}”保存，补充备注后会更准。` : `${topic} 可能和 ${inferred.subCategory} 有关，适合整理成一张私人行动卡。`,
    keywords,
    entities: keywords.slice(0, 5).map((value) => ({ type: entityTypeForCategory(inferred.category), value })),
    searchableText: [input.sourceUrl, input.title, input.rawShareText, input.userNote, inferred.category, inferred.subCategory, keywords.join(" "), actionCard.title, actionCard.nextAction, output].filter(Boolean).join(" "),
    actionCard
  };
}

function buildMockAlbums(savedItems: any[]): unknown[] {
  const groups = new Map<string, any[]>();
  for (const item of Array.isArray(savedItems) ? savedItems : []) {
    const category = readString(item?.category) || "暂存";
    const subCategory = readString(item?.subCategory) || category;
    const key = `${category}:${subCategory}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return Array.from(groups.entries()).slice(0, 8).map(([key, items], index) => {
    const [category, subCategory] = key.split(":");
    const ids = items.map((item) => item.id).filter(Boolean);
    const priorityScore = items.length * 12 + Math.max(0, 8 - index);
    return {
      id: `album_api_fallback_${index + 1}`,
      title: albumTitleForCategory(category, subCategory),
      description: `从已确认导入的 ${items.length} 条「${subCategory}」收藏里，先挑 3 条最容易开始的复活。`,
      category,
      albumType: category === "暂存" ? "needs_note" : "theme",
      keywords: unique(items.flatMap((item) => Array.isArray(item.keywords) ? item.keywords : []).slice(0, 8)),
      savedItemIds: ids,
      recommendedItemIds: ids.slice(0, 3),
      coverItemId: ids[0] ?? "",
      whyThisAlbum: `这些收藏都指向「${subCategory}」这个使用场景。`,
      whyStartHere: "先从最近保存、信息更完整的 3 条开始。",
      suggestedFirstAction: buildSuggestedFirstAction(category),
      priority: priorityScore >= 36 ? "high" : priorityScore >= 18 ? "medium" : "low",
      priorityScore,
      status: "candidate",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
}

function buildKeywords(input: ReturnType<typeof normalizeShareInput>, category = "暂存", subCategory = "待补充备注"): string[] {
  const text = [input.title, input.rawShareText, input.userNote].join(" ");
  const candidates = ["小红书", "封面", "标题", "选题", "AI工具", "工作流", "剪辑", "大理", "深圳", "周末", "展览", "咖啡", "低卡", "晚餐", "备餐", "收纳", "关系", "表达需求", "穿搭", "购物", "读书"];
  const hits = candidates.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  const words = text.split(/[\s,，。；;、/|]+/).map((word) => word.trim()).filter((word) => word.length >= 2 && word.length <= 16);
  return unique([category, subCategory, ...hits, ...words]).slice(0, 12);
}

function inferCategory(text: string): { category: string; subCategory: string; intent: string; whyThisCategory: string } {
  const rules: Array<[string, string, string[], string]> = [
    ["内容创作", "小红书运营", ["小红书", "封面", "标题", "笔记", "账号运营", "图文排版", "涨粉", "选题", "文案", "拍摄", "脚本"], "用户可能想把这条收藏转成可发布的选题、封面结构或内容动作"],
    ["AI 与效率", "AI 工具", ["AI工具", "AI 工具", "ChatGPT", "Claude", "prompt", "提示词", "工作流", "SOP", "自动化", "效率"], "用户可能想复现一个工具用法或工作流"],
    ["出行与探店", "周末去处", ["旅行", "攻略", "路线", "大理", "深圳", "周末", "展览", "徒步", "城市", "探店", "咖啡", "餐厅", "甜品"], "用户可能想把地点或店铺变成一次出行候选"],
    ["饮食与健康", "低卡备餐", ["菜谱", "做饭", "低卡", "晚餐", "备餐", "早餐", "食材", "减脂餐", "健身", "运动"], "用户可能想把饮食或健康收藏转成今天能执行的一份清单"],
    ["情绪与关系", "亲密关系", ["情绪", "关系", "表达需求", "伴侣", "恋爱", "边界", "复盘", "手帐"], "用户可能想把触动自己的观点变成一次自我观察或关系表达"],
    ["穿搭与消费", "购物参考", ["穿搭", "妆容", "发型", "护肤", "风格", "购物", "种草", "平替", "测评", "单品"], "用户可能想把风格或种草内容转成理性购买判断"],
    ["生活与家居", "家居整理", ["收纳", "家居", "改造", "清洁", "租房", "整理", "桌面", "衣柜"], "用户可能想把家居生活技巧变成一个小范围整理任务"],
    ["读书与思考", "读书笔记", ["读书", "书单", "阅读", "读书笔记", "观点", "思考", "摘抄"], "用户可能想把阅读或观点收藏转成自己的笔记"],
    ["技能学习", "技能练习", ["教程", "学习", "剪辑", "摄影", "英语", "写作", "编程", "设计"], "用户可能想学习一个具体技能并完成一次小练习"]
  ];
  const normalized = text.toLowerCase();
  const scored = rules
    .map((rule, index) => ({
      rule,
      index,
      score: rule[2].reduce((sum, term) => {
        const normalizedTerm = term.toLowerCase();
        return normalized.includes(normalizedTerm) ? sum + (term.length >= 4 ? 2 : 1) : sum;
      }, 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const hit = scored[0]?.rule;
  if (!hit) return { category: "暂存", subCategory: "待补充备注", intent: "信息不足，先作为待补充收藏保存", whyThisCategory: "当前没有足够明确的主题词。" };
  return { category: hit[0], subCategory: hit[1], intent: hit[3], whyThisCategory: `命中了「${hit[1]}」相关线索。` };
}

function buildNextAction(category: string, topic: string): string {
  if (category === "内容创作") return `打开原帖，只记录“${topic}”的标题结构、封面构图、开头钩子和评论区高频问题，然后改写成 1 个适合你账号方向的选题。`;
  if (category === "AI 与效率" || category === "技能学习") return `打开原帖，找到第一个工具名或操作步骤；今天只复现第一步，并留下 1 张截图或 1 段可复用 prompt。`;
  if (category === "出行与探店") return `打开原帖，确认地点、时间、交通和预算，把它放进一个候选日期，产出 1 个周末计划草稿。`;
  if (category === "饮食与健康") return `打开原帖，抄下食材、动作或材料清单，标记已有和需要补齐的部分，产出 1 张清单。`;
  if (category === "情绪与关系") return `打开原帖，摘出 1 句最触动你的观点，再写 1 个自己的例子，产出 1 条自我观察记录。`;
  if (category === "穿搭与消费") return `打开原帖，提取风格关键词和核心单品，检查自己是否已有类似物，产出 1 个低成本替代清单。`;
  if (category === "生活与家居") return `打开原帖，选一个不超过 1 平米的小区域，列出要移动、丢掉、购买的东西，产出 1 个 30 分钟整理任务。`;
  if (category === "读书与思考") return `打开原帖，摘出 1 个最想保留的观点，用自己的话改写 3 句，并写下 1 个追问。`;
  return `打开原帖，补充标题、地点或工具名，再写一句你为什么收藏它，产出 1 条可重新生成行动卡的备注。`;
}

function focusPointsForCategory(category: string): string[] {
  if (category === "出行与探店") return ["地点/时间/价格", "交通方式", "评论区补充"];
  if (category === "饮食与健康") return ["食材/动作清单", "作者给的步骤", "替代材料"];
  if (category === "AI 与效率" || category === "技能学习") return ["工具名", "第一个操作步骤", "示例产出"];
  if (category === "内容创作") return ["原帖标题", "封面构图", "开头钩子", "评论区高频问题"];
  return ["原帖标题", "作者给的步骤", "你当初收藏它的原因"];
}

function outputForCategory(category: string): string {
  const map: Record<string, string> = { 内容创作: "一条可发布选题", "AI 与效率": "一张截图、一个 prompt 或一个小作品", 技能学习: "一个小作品或练习记录", 出行与探店: "一个周末计划草稿", 饮食与健康: "一张购物或训练清单", 情绪与关系: "一条自我观察记录", 穿搭与消费: "一个低成本替代清单", 生活与家居: "一个 30 分钟整理任务", 读书与思考: "3 句话笔记 + 1 个追问", 暂存: "一条补充备注" };
  return map[category] ?? "一条补充备注";
}

function entityTypeForCategory(category: string): string {
  const map: Record<string, string> = { 内容创作: "creative_topic", "AI 与效率": "tool", 技能学习: "skill", 出行与探店: "place", 饮食与健康: "dish", 情绪与关系: "reflection_topic", 穿搭与消费: "style_or_product", 生活与家居: "home_area", 读书与思考: "book_or_idea" };
  return map[category] ?? "topic";
}

function albumTitleForCategory(category: string, subCategory: string): string {
  const titles: Record<string, string> = { 内容创作: "把内容灵感变成可发布选题", "AI 与效率": "把 AI 工具真正用进日常工作", 出行与探店: "这个周末可以去哪里", 饮食与健康: "低卡晚餐和备餐", 生活与家居: "把家里一个角落整理好" };
  return titles[category] ?? `${subCategory}：先复活 3 条`;
}

function buildSuggestedFirstAction(category: string): string {
  if (category === "内容创作") return "先打开推荐的第一条，写出 1 个自己的选题标题。";
  if (category === "AI 与效率") return "先复现第一条里的第一个工具步骤。";
  if (category === "出行与探店") return "先确认地点、时间、交通和预算。";
  return "先打开推荐的第一条，完成一个 5-30 分钟的小动作。";
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
