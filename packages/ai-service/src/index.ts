import type {
  ActionCardDraft,
  AiClassificationResult,
  Category,
  EntityTag,
  ShareInput,
  TaskDraft
} from "@revival/shared-types";

type CategoryRule = {
  category: Category;
  terms: string[];
  intent: string;
};

const categoryRules: CategoryRule[] = [
  {
    category: "技能学习",
    terms: ["剪辑", "摄影", "英语", "ai", "AI", "写作", "运营", "编程", "设计", "教程", "入门", "课程", "练习", "学习", "训练", "工具课"],
    intent: "用户可能想学习某项技能，并在之后通过练习把收藏内容用起来"
  },
  {
    category: "旅行地点",
    terms: ["旅行", "攻略", "景点", "城市", "路线", "民宿", "展览", "周边游", "周末", "大理", "深圳", "上海", "北京", "杭州", "成都", "广州", "海边"],
    intent: "用户可能想把一个地点、路线或展览放进未来出行计划"
  },
  {
    category: "美食探店",
    terms: ["餐厅", "咖啡", "甜品", "夜市", "小吃", "探店", "店", "预约", "人均", "火锅", "烤肉", "brunch", "下午茶", "面包"],
    intent: "用户可能想之后去这家店或把它加入约会、聚餐、周末清单"
  },
  {
    category: "菜谱做饭",
    terms: ["菜谱", "做饭", "家常菜", "减脂餐", "甜品", "饮品", "备餐", "食材", "烹饪", "早餐", "午餐", "晚餐", "空气炸锅", "烤箱"],
    intent: "用户可能想复刻一道菜或把它加入日常备餐计划"
  },
  {
    category: "穿搭变美",
    terms: ["穿搭", "妆容", "发型", "护肤", "拍照姿势", "单品", "口红", "精华", "风格", "变美", "显瘦", "配色"],
    intent: "用户可能想获得一个具体造型、妆发或护肤动作"
  },
  {
    category: "家居生活",
    terms: ["收纳", "家居", "改造", "清洁", "氛围", "布置", "租房", "软装", "整理", "厨房", "衣柜", "卫生间"],
    intent: "用户可能想在家里完成一次整理、采购或微改造"
  },
  {
    category: "工作效率",
    terms: ["sop", "SOP", "时间管理", "办公", "效率", "自动化", "流程", "Notion", "Excel", "飞书", "模板", "表格", "快捷键"],
    intent: "用户可能想复制一个工作流，降低重复劳动"
  },
  {
    category: "灵感素材",
    terms: ["选题", "文案", "封面", "拍摄灵感", "账号运营", "审美", "参考", "爆款", "标题", "素材", "脚本", "内容结构"],
    intent: "用户可能想把这条内容转化成创作素材或选题储备"
  }
];

const categoryEntityTypes: Record<Category, string> = {
  技能学习: "skill",
  旅行地点: "place",
  美食探店: "shop",
  菜谱做饭: "dish",
  穿搭变美: "style",
  家居生活: "home",
  工作效率: "tool",
  灵感素材: "creative",
  其他: "topic"
};

const entityHints: Record<string, string[]> = {
  place: ["大理", "深圳", "上海", "北京", "杭州", "成都", "广州", "苏州", "厦门", "长沙", "重庆", "南京", "西安", "海边", "展览", "民宿"],
  shop: ["咖啡", "餐厅", "甜品", "夜市", "小吃", "火锅", "烤肉", "brunch", "面包", "酒馆"],
  dish: ["早餐", "减脂餐", "家常菜", "甜品", "饮品", "便当", "鸡胸肉", "沙拉", "咖喱", "蛋糕"],
  skill: ["剪辑", "摄影", "英语", "AI", "写作", "运营", "编程", "设计", "CapCut", "剪映", "Notion"],
  tool: ["Notion", "Excel", "飞书", "ChatGPT", "自动化", "SOP", "模板", "表格"],
  style: ["通勤", "法式", "显瘦", "妆容", "发型", "护肤", "拍照姿势", "配色"],
  home: ["收纳", "租房", "厨房", "衣柜", "清洁", "软装", "氛围灯", "卫生间"],
  creative: ["选题", "文案", "封面", "脚本", "拍摄", "标题", "账号运营", "审美"]
};

export interface AiProvider {
  classifyAndGenerateActionCard(input: ShareInput): Promise<AiClassificationResult>;
}

export async function classifyAndGenerateActionCardAsync(input: ShareInput): Promise<AiClassificationResult> {
  return classifyAndGenerateActionCard(input);
}

export function classifyAndGenerateActionCard(input: ShareInput): AiClassificationResult {
  const text = combineInput(input);
  const category = inferCategory(text);
  const rule = categoryRules.find((item) => item.category === category);
  const intent = rule?.intent ?? "用户可能想保留这条内容，并在合适的时候重新查看或实践";
  const entities = extractEntities(text, category);
  const keywords = extractKeywords(text, category, entities);
  const summary = buildSummary(input, category, keywords);
  const actionCard = generateActionCard(category, input, keywords, entities);
  const searchableText = buildSearchableText(input, category, intent, summary, keywords, entities, actionCard);

  return {
    category,
    intent,
    summary,
    keywords,
    entities,
    searchableText,
    actionCard
  };
}

function combineInput(input: ShareInput): string {
  return [input.title, input.rawShareText, input.userNote, input.sourceUrl].filter(Boolean).join(" ");
}

function inferCategory(text: string): Category {
  const scores = categoryRules.map((rule) => {
    const score = rule.terms.reduce((total, term) => {
      const hit = text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
      return total + (hit ? Math.max(1, Math.min(4, term.length)) : 0);
    }, 0);
    return { category: rule.category, score };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score > 0 ? scores[0].category : "其他";
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

function buildSummary(input: ShareInput, category: Category, keywords: string[]): string {
  const topic = cleanTitle(input.title || input.rawShareText) || "这条收藏";
  const keywordText = keywords.slice(0, 3).join("、") || category;
  return `${topic} 可能和${keywordText}有关，适合被整理成一张可执行的${category}行动卡。`;
}

function cleanTitle(value: string): string {
  return value
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 42);
}

function generateActionCard(category: Category, input: ShareInput, keywords: string[], entities: EntityTag[]): ActionCardDraft {
  const title = cleanTitle(input.title) || cleanTitle(input.rawShareText) || `${category}行动卡`;
  const lead = entities[0]?.value || keywords[0] || title;

  switch (category) {
    case "技能学习":
      return card(
        `3天上手：${lead}`,
        `围绕${lead}完成一次可展示的小练习`,
        "今天先花 20 分钟拆解一个参考案例，并记下 3 个可模仿的动作",
        "20分钟",
        "低",
        [
          task("拆解参考", "找出收藏内容里最值得模仿的一步", "20分钟"),
          task("完成一次小练习", "照着参考做一个最小作品，不追求完美", "30分钟"),
          task("复盘并保存模板", "记录可复用步骤，下次直接套用", "15分钟")
        ],
        {
          学习目标: `掌握${lead}的入门方法并完成一次练习`,
          适合人群: "想低成本开始，但一直停在收藏阶段的人",
          第一步行动: "打开原帖确认关键步骤，只摘取一个今天能做的小动作",
          练习任务: ["拆解一个案例", "完成一个最小练习", "记录复盘"],
          预计耗时: "20-45分钟",
          "3天学习计划": ["第1天拆解参考", "第2天完成练习", "第3天复盘优化"],
          "7天学习计划": ["前2天看参考", "中间3天连续练习", "后2天整理成自己的模板"],
          完成标准: "产出一个能保存、复用或展示的小成果"
        }
      );
    case "旅行地点":
      return card(
        `周末可执行：${lead}出行卡`,
        `判断${lead}是否适合近期加入旅行计划`,
        "今天先确认位置、交通和预算，只保留一个最想去的时间窗口",
        "15分钟",
        "低",
        [
          task("确认地点和交通", "打开原帖核对地址、营业时间或路线", "15分钟"),
          task("列出半日路线", "把想去的点压缩成 2-3 个", "20分钟"),
          task("设置出行提醒", "为周末或假期放一个提醒", "5分钟")
        ],
        {
          地点名称: lead,
          适合季节: "优先查看原帖发布时间和近期天气后决定",
          推荐游玩时长: "半天到1天",
          交通建议: "先确认公共交通或停车情况，再决定是否顺路",
          预算区间: "低到中等，按门票、餐饮和交通单独估算",
          路线安排: ["确认核心地点", "安排附近餐饮", "预留返程时间"],
          避坑提醒: "不要只看氛围图，出发前回到原帖核对最新信息",
          适合人群: "想周末换个环境、又不想做复杂攻略的人",
          可加入的旅行计划: "3天短途灵感计划"
        }
      );
    case "美食探店":
      return card(
        `${lead}探店行动卡`,
        `判断这家店是否值得加入近期约饭清单`,
        "今天先确认店名、位置、人均和是否要预约",
        "10分钟",
        "低",
        [
          task("确认基础信息", "打开原帖核对店名、地址和营业时间", "10分钟"),
          task("加入约饭候选", "给它标一个适合去的时间和同行人", "5分钟"),
          task("到店后记录反馈", "回来标记是否值得二刷", "5分钟")
        ],
        {
          店名或地点: lead,
          推荐菜品: "从原帖分享文案中确认，不在这里复制完整菜单",
          适合时间: "午餐、下午茶或周末聚餐",
          是否需要预约: "建议出发前确认",
          人均预算: "按原帖线索和平台信息二次确认",
          打卡优先级: "中",
          注意事项: "先看距离和排队情况，再决定是否专门前往",
          适合和谁去: "朋友、同事或想轻松见面的人"
        }
      );
    case "菜谱做饭":
      return card(
        `${lead}复刻卡`,
        `把收藏里的菜谱变成一次真实下厨`,
        "今天先列购物清单，只买缺的关键食材",
        "30分钟",
        "中",
        [
          task("列食材", "根据分享信息整理必须买的 3-5 样食材", "10分钟"),
          task("完成一次复刻", "按原帖步骤做一版简单版本", "30分钟"),
          task("记录口味调整", "记下下次要少盐、少油或换食材的地方", "5分钟")
        ],
        {
          菜名: lead,
          食材清单: ["主食材", "调味料", "可选配菜"],
          制作步骤: ["确认原帖步骤", "处理食材", "完成烹饪", "记录调整"],
          准备时间: "10-15分钟",
          烹饪时间: "20-30分钟",
          可替代食材: ["同类蔬菜", "低脂蛋白", "现有调味料"],
          购物清单: ["缺少的主食材", "关键调味料"],
          难度等级: "中",
          适合场景: "工作日晚餐或周末备餐"
        }
      );
    case "穿搭变美":
      return card(
        `${lead}今日小改变`,
        "把收藏里的风格灵感转成一个今天就能试的小动作",
        "今天只改一个地方，比如配色、发型、唇色或拍照姿势",
        "10分钟",
        "低",
        [
          task("找一个可复制点", "从原帖里只选一个动作，不整套照搬", "10分钟"),
          task("用现有物品替代", "先在衣柜或化妆包里找近似单品", "10分钟"),
          task("拍照对比", "保存一张前后对比，决定是否保留", "5分钟")
        ],
        {
          风格关键词: keywords.slice(0, 4),
          适合场景: "通勤、约会、拍照或日常出门",
          单品清单: ["现有基础单品", "一个亮点配件", "可替代妆发工具"],
          操作步骤: ["选一个可复制点", "用现有物品试一次", "拍照检查效果"],
          低成本替代方案: "先用已有单品做相近效果，再决定是否购买",
          注意事项: "避免因为收藏冲动立刻下单整套单品",
          今日可执行小改变: "只调整一个配色或一个妆发细节"
        }
      );
    case "家居生活":
      return card(
        `${lead}周末改造卡`,
        "把家居收藏转成一次可完成的小范围整理",
        "今天先选一个最小区域，比如桌面、衣柜一层或厨房台面",
        "25分钟",
        "中",
        [
          task("选定一个区域", "只处理 1 平方米以内，降低启动压力", "5分钟"),
          task("列采购或清理清单", "先用家里已有工具，不够再买", "10分钟"),
          task("周末完成改造", "拍一张改造前后对比", "30分钟")
        ],
        {
          改造目标: `完成${lead}相关的小范围优化`,
          采购清单: ["收纳工具", "清洁用品", "替换件"],
          操作步骤: ["清空", "分类", "保留常用", "恢复动线"],
          预算区间: "0-200元，优先利用已有物品",
          难度等级: "中",
          注意事项: "不要一开始就全屋改造，先做一个最小区域",
          周末执行计划: ["周五列清单", "周六执行", "周日复盘"]
        }
      );
    case "工作效率":
      return card(
        `${lead}效率 SOP`,
        "把收藏里的方法转成可复制的个人工作流",
        "今天先把流程拆成 3 步，找一个正在做的任务试用",
        "20分钟",
        "中",
        [
          task("拆流程", "从收藏里提取输入、步骤、输出", "15分钟"),
          task("套用一次", "找一个真实任务跑一遍", "25分钟"),
          task("沉淀模板", "把有效步骤保存成自己的 SOP", "10分钟")
        ],
        {
          解决的问题: `减少${lead}相关的重复决策和重复操作`,
          适用场景: "日常办公、内容生产、项目推进或个人管理",
          工具名称: lead,
          操作步骤: ["确认输入", "执行关键步骤", "检查输出", "保存模板"],
          注意事项: "先小范围试用，不要一次迁移所有流程",
          可复制SOP: ["触发条件", "执行步骤", "检查清单", "复盘记录"],
          预计节省时间: "每次 10-30 分钟"
        }
      );
    case "灵感素材":
      return card(
        `${lead}创作灵感卡`,
        "把收藏里的灵感转成一个可以开工的选题或结构",
        "今天先改写出 3 个自己的标题方向",
        "15分钟",
        "低",
        [
          task("提取结构", "只保留原帖的结构启发，不复制完整表达", "10分钟"),
          task("改写选题", "写出 3 个适合自己账号的变体", "15分钟"),
          task("选择一个开工", "确定标题、开头和素材清单", "15分钟")
        ],
        {
          核心灵感: lead,
          关键词: keywords.slice(0, 6),
          可复用结构: "痛点切入 -> 具体例子 -> 可执行建议 -> 结果对比",
          可改写方向: ["个人经验版", "清单版", "避坑版"],
          适合的平台: "小红书、公众号、短视频脚本",
          可生成的选题: [`${lead}入门清单`, `${lead}避坑记录`, `${lead}实践复盘`],
          下一步创作动作: "写一个 100 字开头，并列出 3 个素材镜头"
        }
      );
    default:
      return card(
        `${title}行动卡`,
        "判断这条收藏之后如何使用",
        "今天先给它补一个自己的使用场景，再决定是否加入计划库",
        "10分钟",
        "低",
        [
          task("补充使用场景", "写下当初为什么想收藏它", "5分钟"),
          task("决定下一步", "选择只保存、加入今日行动或重新分类", "5分钟")
        ],
        {
          内容摘要: buildSummary(input, "其他", keywords),
          可能的收藏原因: "有参考价值，但暂时无法判断具体执行场景",
          可以如何使用: "作为待整理线索，之后通过关键词找回原帖",
          下一步行动: "补充备注或重新分类",
          相关关键词: keywords,
          是否建议重新分类: "建议在行动卡详情里手动调整分类"
        }
      );
  }
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
