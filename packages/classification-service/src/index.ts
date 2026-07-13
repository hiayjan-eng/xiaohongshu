import type {
  ClassificationCandidate,
  ClassificationConfidence,
  ClassificationCorrection,
  ClassificationShadowResult,
  ContentDomain,
  EntityTag,
  SavedIntent,
  ShareInput
} from "@revival/shared-types";

export interface ClassificationInput extends ShareInput {
  visibleText?: string;
  hashtags?: string[];
  author?: string;
  badges?: string[];
  keywords?: string[];
}

export interface FieldSeparatedText {
  title: string;
  hashtags: string[];
  author: string;
  visibleText: string;
  userNote: string;
  badges: string[];
  sourceUrl: string;
  textForClassification: string;
}

export interface EvidenceBundle {
  positiveEvidence: string[];
  negativeEvidence: string[];
  conflictingEvidence: string[];
}

export interface ClassificationResult {
  contentDomain: ContentDomain;
  contentSubDomain: string;
  savedIntent: SavedIntent;
  secondaryIntents: SavedIntent[];
  confidence: ClassificationConfidence;
  whyThisDomain: string;
  whyThisIntent: string;
  classificationReason: string;
  positiveEvidence: string[];
  negativeEvidence: string[];
  conflictingEvidence: string[];
  dominantIntent: string;
  topCandidates: ClassificationCandidate[];
  shadow: ClassificationShadowResult;
  keywords: string[];
  entities: EntityTag[];
}

export interface ClassificationProvider {
  readonly name: string;
  classify(input: ClassificationInput, corrections?: ClassificationCorrection[]): ClassificationProviderResult;
}

export interface ClassificationProviderResult {
  candidate: ClassificationCandidate;
  candidates: ClassificationCandidate[];
  evidence: EvidenceBundle;
  confidence: ClassificationConfidence;
  dominantIntent: string;
}

type Prototype = {
  domain: ContentDomain;
  subDomain: string;
  description: string;
  entityType: string;
  strong: string[];
  terms: string[];
  examples: string[];
  anti: string[];
};

export const CLASSIFICATION_WEIGHTS = {
  strongRule: 0.35,
  semantic: 0.5,
  userCorrection: 0.15
} as const;

export const DOMAIN_SUBDOMAINS: Record<ContentDomain, string[]> = {
  内容创作: ["小红书运营", "封面设计", "选题策划", "文案写作", "视频剪辑", "拍摄脚本", "账号复盘"],
  "AI 与效率": ["AI 工具", "Prompt 工程", "自动化工作流", "软件教程", "决策辅助", "办公效率"],
  技能学习: ["技能练习", "课程教程", "摄影修图", "语言学习", "设计学习", "编程学习"],
  工作与职业: ["招聘求职", "创业团队", "职场成长", "工作方法", "行业机会", "自由职业", "副业探索"],
  商业与经营: ["创业经营", "商业模式", "独立站运营", "跨境电商", "选品与定价", "品牌营销", "销售与变现", "门店经营", "商业案例"],
  出行与探店: ["周末去处", "展览活动", "城市路线", "咖啡餐厅", "徒步周边", "旅行攻略"],
  饮食与健康: ["家常备餐", "低卡饮食", "健身运动", "早餐轻食", "健康管理"],
  生活与家居: ["收纳整理", "租房改造", "清洁流程", "家居布置", "生活方式"],
  穿搭与消费: ["穿搭风格", "护肤美妆", "购物参考", "单品测评", "低成本替代"],
  情绪与关系: ["亲密关系", "情绪成长", "自我观察", "沟通表达", "心理复盘"],
  读书与思考: ["读书笔记", "观点思考", "知识摘抄", "认知模型"],
  暂存: ["待补充备注", "待确认分类"]
};

const prototypes: Prototype[] = [
  p("内容创作", "小红书运营", "账号定位、内容运营、数据复盘和涨粉方法", "creative_topic", ["小红书运营", "账号运营", "爆款笔记", "涨粉", "数据复盘"], ["小红书", "账号", "笔记", "运营", "复盘", "流量", "发布", "内容"], ["小红书账号运营复盘模板", "生活方式账号一周选题规划", "爆款笔记标题结构拆解"], ["招聘内容运营", "内容运营岗位"]),
  p("内容创作", "封面设计", "封面、标题、排版和图文视觉参考", "creative_topic", ["封面设计", "封面", "标题排版", "图文排版"], ["标题", "封面", "排版", "构图", "视觉", "图文", "模板"], ["小红书封面设计技巧", "封面标题排版参考", "图文笔记封面构图"], ["商品封面价格"]),
  p("内容创作", "视频剪辑", "短视频剪辑、运镜、脚本和拍摄后期", "creative_topic", ["视频剪辑", "AI 剪辑", "短视频教程", "运镜"], ["剪辑", "短视频", "拍摄", "脚本", "字幕", "转场", "运镜"], ["AI 剪辑视频教程", "剪映新手 7 天入门", "探店视频运镜脚本"], ["剪辑岗位招聘"]),
  p("AI 与效率", "AI 工具", "AI 工具、Codex、ChatGPT、Claude 等工具用法", "tool", ["AI工具", "AI 工具", "Codex", "ChatGPT", "Claude", "Gemini"], ["AI", "工具", "代码助手", "模型", "插件", "智能体", "生成"], ["3个方法让 Codex 帮你干活", "AI工具日常工作流入门", "用 ChatGPT 整理资料"], ["AI公司招聘"]),
  p("AI 与效率", "Prompt 工程", "提示词、多角色、结构化输入输出和 AI 对话方法", "prompt", ["Prompt", "提示词", "多角色", "圆桌 Prompt"], ["prompt", "提示词", "角色", "对话", "结构化", "指令"], ["多角色 Prompt 帮我做战略决策", "Jung Mankiw Munger Musk 圆桌讨论", "提示词模板复用"], ["招聘 Prompt 工程师"]),
  p("AI 与效率", "自动化工作流", "自动化流程、SOP、效率系统和办公工具串联", "workflow", ["自动化工作流", "SOP", "工作流", "效率流程"], ["自动化", "流程", "效率", "Notion", "飞书", "Excel", "办公", "日常"], ["AI 工具日常工作流入门", "飞书自动化报表 SOP", "用 Notion 管项目"], ["自动化岗位"]),
  p("工作与职业", "招聘求职", "招聘、求职、岗位、简历、面试和办公地点", "job", ["招聘", "招人", "加入我们", "岗位", "简历", "面试"], ["求职", "薪资", "全职", "兼职", "实习", "优先", "办公地点", "广深", "深圳公司", "广州公司"], ["欢迎大家加入我的创业公司（广深优先）", "深圳公司招聘内容运营", "跨境运营岗位招人"], ["深圳周末展览", "广州咖啡店"]),
  p("工作与职业", "创业团队", "创业公司、团队招募、合伙人和早期团队机会", "team", ["创业公司", "加入我的公司", "合伙人", "团队招募"], ["团队", "早期", "招募", "共创", "远程", "办公", "创业伙伴"], ["加入我的创业团队", "寻找早期合伙人", "广深优先创业公司招人"], ["创业经营方法"]),
  p("工作与职业", "职场成长", "职场技能、工作沟通、管理和职业发展", "career", ["职场成长", "职业规划", "升职", "绩效"], ["职场", "同事", "老板", "汇报", "管理", "成长", "沟通"], ["职场新人如何汇报工作", "职业规划三年路线", "如何做向上管理"], ["亲密关系沟通"]),
  p("商业与经营", "独立站运营", "独立站、跨境独立站、流量和转化运营", "business", ["独立站", "shopify", "Shopify"], ["站点", "落地页", "转化率", "流量", "投放", "复购", "GMV"], ["拆解一个赚钱的独立站", "独立站如何提高转化率", "Shopify 选品案例"], ["独立站招聘运营"]),
  p("商业与经营", "跨境电商", "跨境、电商、供应链、海外市场和运营", "business", ["跨境电商", "跨境选品", "亚马逊", "TikTok Shop"], ["跨境", "电商", "供应链", "出海", "海外", "运营", "产品"], ["独立站招聘跨境运营", "跨境电商选品清单", "TikTok Shop 爆品复盘"], ["跨境运营岗位招聘"]),
  p("商业与经营", "选品与定价", "选品、价格、溢价、毛利、客单价和产品策略", "business", ["选品", "定价", "情绪溢价", "客单价", "毛利"], ["价格", "溢价", "商品", "产品", "利润", "成本", "转化", "卖出"], ["几块串珠卖出10倍情绪溢价", "情绪价值如何提高商品客单价", "低成本产品怎么做溢价"], ["情绪表达需求"]),
  p("商业与经营", "商业模式", "商业模式、营收、创业经营和变现方式", "business", ["商业模式", "营收", "变现", "创业经营"], ["复购", "销售", "增长", "案例", "收入", "模型", "品牌"], ["创业公司如何做员工激励", "一个小店如何做复购", "商业案例拆解"], ["创业公司招聘"]),
  p("出行与探店", "展览活动", "展览、美术馆、周末活动和城市文化路线", "place", ["展览", "美术馆", "展", "周末展览"], ["深圳", "广州", "上海", "周末", "路线", "门票", "开放时间"], ["深圳周末展览路线", "上海近期展览清单", "广州周末美术馆"], ["深圳公司招聘"]),
  p("出行与探店", "咖啡餐厅", "咖啡店、餐厅、甜品店和探店消费信息", "place", ["咖啡店", "餐厅", "探店", "brunch"], ["人均", "营业时间", "预约", "店名", "甜品", "小吃"], ["深圳周末咖啡店", "广州安静咖啡店 brunch", "成都甜品探店"], ["餐饮门店经营"]),
  p("出行与探店", "旅行攻略", "城市旅行、路线、交通和预算", "place", ["旅行攻略", "路线", "周边游", "民宿"], ["大理", "成都", "杭州", "徒步", "交通", "预算", "景点"], ["大理 3 天慢旅行路线", "杭州周边徒步一日路线", "成都周末路线"], ["城市招聘"]),
  p("饮食与健康", "家常备餐", "菜谱、备餐、食材和购物清单", "dish", ["低卡晚餐", "备餐", "菜谱", "食材清单"], ["做饭", "早餐", "便当", "空气炸锅", "鸡胸肉", "购物清单"], ["低卡晚餐备餐", "空气炸锅鸡胸肉便当", "10 分钟高蛋白早餐"], ["餐饮经营"]),
  p("饮食与健康", "健身运动", "健身、训练、运动和体态管理", "fitness", ["健身", "训练计划", "瑜伽", "普拉提"], ["运动", "跑步", "拉伸", "体态", "组数", "动作"], ["20 分钟居家训练", "普拉提体态改善", "跑步新手计划"], ["运动品牌营销"]),
  p("生活与家居", "收纳整理", "收纳、整理、清洁和家务流程", "home", ["收纳", "整理", "清洁", "断舍离"], ["衣柜", "厨房", "台面", "冰箱", "流程", "周末"], ["衣柜换季收纳整理法", "厨房清洁 30 分钟流程", "桌面收纳"], ["收纳产品定价"]),
  p("生活与家居", "租房改造", "租房、软装、家居布置和低预算改造", "home", ["租房改造", "软装", "家居布置"], ["灯光", "地毯", "收纳盒", "氛围", "预算", "房间"], ["租房改造低预算氛围布置", "小房间软装", "出租屋灯光改造"], ["装修公司招聘"]),
  p("穿搭与消费", "购物参考", "种草、测评、价格、品牌和购买决策", "product", ["购物参考", "种草", "测评", "平替"], ["单品", "品牌", "价格", "下单", "避雷", "替代"], ["通勤包测评", "护肤品避雷", "低成本穿搭平替"], ["商品客单价"]),
  p("穿搭与消费", "穿搭风格", "穿搭、美妆、风格关键词和搭配方法", "style", ["穿搭", "妆容", "风格关键词"], ["护肤", "发型", "单品", "搭配", "显瘦", "通勤"], ["夏天通勤穿搭", "低成本法式风格", "护肤空瓶测评"], ["服装品牌营销"]),
  p("情绪与关系", "亲密关系", "亲密关系、表达需求、边界感和沟通", "emotion", ["亲密关系", "表达需求", "边界感", "关系中"], ["伴侣", "沟通", "需求", "关系", "冲突", "安全感"], ["关系中如何表达需求", "亲密关系里的边界感", "如何温和表达不满"], ["客户关系管理"]),
  p("情绪与关系", "情绪成长", "情绪、心理、自我观察和手帐复盘", "emotion", ["情绪成长", "自我观察", "复盘", "手帐"], ["焦虑", "共鸣", "觉察", "疗愈", "内耗", "敏感"], ["把敏感还给自己", "焦虑时怎么做复盘", "自我观察记录"], ["情绪溢价"]),
  p("读书与思考", "读书笔记", "书籍、摘抄、观点和读书复盘", "book", ["读书笔记", "摘抄", "书单"], ["读书", "观点", "认知", "章节", "作者", "思考"], ["一本书改变我的表达方式", "读书摘抄和复盘", "认知模型笔记"], ["书店探店"])
];

export class RuleClassificationProvider implements ClassificationProvider {
  readonly name = "rule";

  classify(input: ClassificationInput, corrections: ClassificationCorrection[] = []): ClassificationProviderResult {
    const fields = separateClassificationFields(input);
    const scoreMap = scoreByRules(fields);
    applyCorrectionBoost(scoreMap, fields.textForClassification, corrections, 18);
    const candidates = toCandidates(scoreMap);
    const evidence = buildEvidence(fields, candidates[0]);
    return {
      candidate: candidates[0],
      candidates,
      evidence,
      confidence: inferConfidence(candidates, fields, evidence),
      dominantIntent: inferDominantIntent(fields, candidates[0]).intent
    };
  }
}

export class SemanticClassificationProvider implements ClassificationProvider {
  readonly name = "semantic-local-prototype";

  classify(input: ClassificationInput, corrections: ClassificationCorrection[] = []): ClassificationProviderResult {
    const fields = separateClassificationFields(input);
    const inputTokens = tokenize(fields.textForClassification);
    const scores = new Map<string, { prototype: Prototype; score: number; reasons: string[] }>();
    prototypes.forEach((prototype) => {
      const prototypeText = [prototype.domain, prototype.subDomain, prototype.description, ...prototype.examples, ...prototype.terms].join(" ");
      const similarity = jaccard(inputTokens, tokenize(prototypeText));
      const exampleHit = prototype.examples.some((example) => overlapScore(fields.textForClassification, example) > 0.18) ? 12 : 0;
      const antiPenalty = prototype.anti.some((phrase) => fields.textForClassification.includes(phrase)) ? 10 : 0;
      const score = similarity * 100 + exampleHit - antiPenalty;
      scores.set(keyOf(prototype.domain, prototype.subDomain), {
        prototype,
        score,
        reasons: score > 0 ? [`语义接近「${prototype.subDomain}」原型`] : []
      });
    });
    applyCorrectionBoost(scores, fields.textForClassification, corrections, 12);
    const candidates = toCandidates(scores);
    const evidence = buildEvidence(fields, candidates[0]);
    return {
      candidate: candidates[0],
      candidates,
      evidence,
      confidence: inferConfidence(candidates, fields, evidence),
      dominantIntent: inferDominantIntent(fields, candidates[0]).intent
    };
  }
}

export class HybridClassificationProvider implements ClassificationProvider {
  readonly name = "hybrid-rule-semantic-local";
  private readonly rule = new RuleClassificationProvider();
  private readonly semantic = new SemanticClassificationProvider();

  classify(input: ClassificationInput, corrections: ClassificationCorrection[] = []): ClassificationProviderResult {
    const fields = separateClassificationFields(input);
    const rule = this.rule.classify(input, corrections);
    const semantic = this.semantic.classify(input, corrections);
    const scoreMap = new Map<string, { prototype: Prototype; score: number; reasons: string[] }>();

    prototypes.forEach((prototype) => {
      const key = keyOf(prototype.domain, prototype.subDomain);
      const ruleScore = rule.candidates.find((candidate) => keyOf(candidate.contentDomain, candidate.contentSubDomain) === key)?.score ?? 0;
      const semanticScore = semantic.candidates.find((candidate) => keyOf(candidate.contentDomain, candidate.contentSubDomain) === key)?.score ?? 0;
      const correctionScore = correctionSimilarity(fields.textForClassification, corrections, prototype.domain, prototype.subDomain) * 100;
      scoreMap.set(key, {
        prototype,
        score: ruleScore * CLASSIFICATION_WEIGHTS.strongRule + semanticScore * CLASSIFICATION_WEIGHTS.semantic + correctionScore * CLASSIFICATION_WEIGHTS.userCorrection,
        reasons: unique([
          ...(rule.candidates.find((candidate) => keyOf(candidate.contentDomain, candidate.contentSubDomain) === key)?.reasons ?? []),
          ...(semantic.candidates.find((candidate) => keyOf(candidate.contentDomain, candidate.contentSubDomain) === key)?.reasons ?? []),
          correctionScore > 0 ? "命中过往用户纠正样本" : ""
        ].filter(Boolean))
      });
    });

    const candidates = toCandidates(scoreMap);
    const evidence = buildEvidence(fields, candidates[0]);
    const intent = inferDominantIntent(fields, candidates[0]);
    const confidence = inferConfidence(candidates, fields, evidence);
    return {
      candidate: candidates[0],
      candidates,
      evidence,
      confidence,
      dominantIntent: intent.intent
    };
  }
}

const defaultHybridProvider = new HybridClassificationProvider();
const defaultRuleProvider = new RuleClassificationProvider();
const defaultSemanticProvider = new SemanticClassificationProvider();

export function classifyCollectionInput(input: ClassificationInput, corrections: ClassificationCorrection[] = []): ClassificationResult {
  const fields = separateClassificationFields(input);
  const rule = defaultRuleProvider.classify(input, corrections);
  const semantic = defaultSemanticProvider.classify(input, corrections);
  const hybrid = defaultHybridProvider.classify(input, corrections);
  const finalCandidate = hybrid.candidate;
  const intent = inferDominantIntent(fields, finalCandidate);
  const keywords = extractClassificationKeywords(fields, finalCandidate, intent.intent);
  const entities = extractClassificationEntities(fields, finalCandidate);
  const shadow: ClassificationShadowResult = {
    rule: rule.candidate,
    semanticCandidates: semantic.candidates.slice(0, 3),
    hybrid: finalCandidate,
    provider: defaultHybridProvider.name
  };
  const reason = buildClassificationReason(finalCandidate, hybrid.evidence, intent.reason, hybrid.confidence);

  return {
    contentDomain: finalCandidate.contentDomain,
    contentSubDomain: finalCandidate.contentSubDomain,
    savedIntent: intent.intent,
    secondaryIntents: intent.secondary,
    confidence: hybrid.confidence,
    whyThisDomain: reason,
    whyThisIntent: intent.reason,
    classificationReason: reason,
    positiveEvidence: hybrid.evidence.positiveEvidence,
    negativeEvidence: hybrid.evidence.negativeEvidence,
    conflictingEvidence: hybrid.evidence.conflictingEvidence,
    dominantIntent: intent.intent,
    topCandidates: hybrid.candidates.slice(0, 3),
    shadow,
    keywords,
    entities
  };
}


export function separateClassificationFields(input: ClassificationInput): FieldSeparatedText {
  const rawTitle = input.title || extractTitleFromText(input.rawShareText) || extractTitleFromText(input.visibleText || "");
  const hashtags = unique([...(input.hashtags ?? []), ...extractHashtags(input.rawShareText), ...extractHashtags(input.visibleText || "")]);
  const visibleText = cleanField(input.visibleText || input.rawShareText).slice(0, 480);
  const title = cleanField(rawTitle).slice(0, 80);
  const userNote = cleanField(input.userNote);
  const sourceUrl = cleanField(input.sourceUrl);
  const author = cleanField(input.author || extractAuthor(input.rawShareText));
  const badges = unique(input.badges ?? []);
  const textForClassification = [userNote, title, hashtags.join(" "), visibleText, badges.join(" ")].filter(Boolean).join(" ");
  return { title, hashtags, author, visibleText, userNote, badges, sourceUrl, textForClassification };
}

function scoreByRules(fields: FieldSeparatedText): Map<string, { prototype: Prototype; score: number; reasons: string[] }> {
  const text = fields.textForClassification;
  const map = new Map<string, { prototype: Prototype; score: number; reasons: string[] }>();
  prototypes.forEach((prototype) => {
    let score = 0;
    const reasons: string[] = [];
    const strongHits = prototype.strong.filter((term) => containsTerm(text, term));
    const termHits = prototype.terms.filter((term) => containsTerm(text, term));
    if (strongHits.length) {
      score += strongHits.length * 24;
      reasons.push(`强线索：${strongHits.slice(0, 3).join("、")}`);
    }
    if (termHits.length) {
      score += termHits.length * 8;
      reasons.push(`相关线索：${termHits.slice(0, 4).join("、")}`);
    }
    if (fields.title && strongHits.some((hit) => fields.title.includes(hit))) score += 18;
    if (fields.userNote && termHits.some((hit) => fields.userNote.includes(hit))) score += 20;
    const antiHits = prototype.anti.filter((term) => containsTerm(text, term));
    if (antiHits.length) {
      score -= antiHits.length * 18;
      reasons.push(`排除线索：${antiHits.slice(0, 2).join("、")}`);
    }
    map.set(keyOf(prototype.domain, prototype.subDomain), { prototype, score, reasons });
  });
  applyContextDisambiguation(map, fields);
  return map;
}

function applyContextDisambiguation(map: Map<string, { prototype: Prototype; score: number; reasons: string[] }>, fields: FieldSeparatedText) {
  const text = fields.textForClassification;
  if (/招聘|招人|加入.*公司|加入我们|岗位|简历|面试|薪资|全职|实习|创业团队/.test(text)) {
    boostDomain(map, "工作与职业", 42, "招聘/岗位语境优先于城市地点");
    penalizeDomain(map, "出行与探店", 35, "城市词出现在招聘语境中，不按出行处理");
  }
  if (/独立站|跨境|电商|选品|客单价|毛利|溢价|供应链|商业模式|转化率|投放|复购|变现/.test(text)) {
    boostDomain(map, "商业与经营", 42, "商业经营实体优先于抽象情绪词");
    penalizeDomain(map, "情绪与关系", 30, "情绪词出现在商品/定价语境中，不按关系情绪处理");
  }
  if (/AI\s*剪辑|AI剪辑|短视频|封面|小红书.*(标题|封面|笔记|运营)/i.test(text)) {
    boostDomain(map, "内容创作", 24, "内容制作语境优先保留创作主题");
  }
  if (/多角色|Prompt|提示词|Codex|ChatGPT|Claude|AI工具/i.test(text)) {
    boostDomain(map, "AI 与效率", 26, "AI 工具和 Prompt 语境明确");
  }
  if (/关系中|亲密关系|表达需求|边界感|伴侣/.test(text) && !/商品|客单价|溢价|定价|品牌/.test(text)) {
    boostDomain(map, "情绪与关系", 34, "关系表达语境明确");
  }
  if (/深圳|广州|上海|大理|杭州|成都/.test(text) && /周末|展览|咖啡|路线|探店|旅行|徒步/.test(text) && !/招聘|岗位|公司/.test(text)) {
    boostDomain(map, "出行与探店", 28, "地点和周末/店铺/路线共同出现");
  }
}

function inferDominantIntent(fields: FieldSeparatedText, candidate: ClassificationCandidate): { intent: SavedIntent; secondary: SavedIntent[]; reason: string } {
  const text = fields.textForClassification;
  if (/招聘|招人|岗位|简历|面试/.test(text)) return { intent: "求职关注", secondary: ["以后联系", "工作决策参考"], reason: "这条收藏像是岗位或团队机会，后续可能需要联系或评估是否匹配。" };
  if (/加入.*公司|创业团队|合伙人|团队招募/.test(text)) return { intent: "创业团队参考", secondary: ["以后联系", "工作决策参考"], reason: "这条收藏指向创业团队或合作机会，适合留作后续联系和判断。" };
  if (/独立站|商业案例|溢价|客单价|毛利|复购|商业模式/.test(text)) return { intent: "商业案例参考", secondary: ["想学习", "工作决策参考"], reason: "这条收藏更像商业案例或经营方法，适合用于学习和工作判断。" };
  if (/教程|练习|入门|学会|想学习|复现|照着做|方法/.test(text) && !/招聘|岗位|求职/.test(text)) return { intent: /复现|照着做/.test(text) ? "想复现" : "想学习", secondary: ["想复现", "以后查阅"], reason: "它包含教程、方法或练习线索，适合先学习或复现一个最小步骤。" };
  if (candidate.contentDomain === "内容创作" || /封面|标题|选题|脚本|内容/.test(text)) return { intent: "内容创作参考", secondary: ["想复现", "想学习"], reason: "它包含可复用的内容结构、选题、封面或脚本线索。" };
  if (candidate.contentDomain === "AI 与效率" || /AI|Prompt|自动化|SOP|工作流/i.test(text)) return { intent: "工作决策参考", secondary: ["想复现", "想学习"], reason: "它可以转成工具步骤、Prompt 或工作流程，适合用在实际任务里。" };
  if (candidate.contentDomain === "出行与探店") return { intent: "想去", secondary: ["以后查阅"], reason: "它包含地点、路线、店铺或活动线索，适合变成候选安排。" };
  if (candidate.contentDomain === "饮食与健康" || /菜谱|备餐|训练|健身/.test(text)) return { intent: "想做", secondary: ["想复现"], reason: "它适合转成一次做饭、备餐或训练动作。" };
  if (candidate.contentDomain === "穿搭与消费") return { intent: "想买", secondary: ["以后查阅"], reason: "它更像风格、单品或购买判断的参考。" };
  if (candidate.contentDomain === "情绪与关系") return { intent: "情绪共鸣", secondary: ["以后查阅"], reason: "它触发的是关系表达、自我观察或情绪复盘用途。" };
  if (candidate.contentDomain === "技能学习" || /教程|课程|练习|入门/.test(text)) return { intent: "想学习", secondary: ["想复现"], reason: "它包含教程或练习入口，适合先做一个最小练习。" };
  return { intent: "以后查阅", secondary: ["暂时保存"], reason: "信息还不够完整，先作为待查阅线索保存。" };
}

function inferConfidence(candidates: ClassificationCandidate[], fields: FieldSeparatedText, evidence: EvidenceBundle): ClassificationConfidence {
  const top = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  const usefulLength = fields.textForClassification.replace(/https?:\/\/\S+/g, "").trim().length;
  if (usefulLength < 6 || top < 12) return "low";
  if (top - second >= 18 && evidence.conflictingEvidence.length === 0) return "high";
  if (top - second >= 8) return "medium";
  return "low";
}

function buildEvidence(fields: FieldSeparatedText, candidate: ClassificationCandidate): EvidenceBundle {
  const prototype = prototypes.find((item) => item.domain === candidate.contentDomain && item.subDomain === candidate.contentSubDomain);
  const text = fields.textForClassification;
  const positiveEvidence = prototype ? unique([...prototype.strong, ...prototype.terms].filter((term) => containsTerm(text, term))).slice(0, 8) : [];
  const conflictingEvidence: string[] = [];
  if (candidate.contentDomain !== "出行与探店" && /深圳|广州|上海|大理|杭州|成都/.test(text)) conflictingEvidence.push("包含地点词，但上下文不一定是出行");
  if (candidate.contentDomain !== "情绪与关系" && /情绪|关系/.test(text)) conflictingEvidence.push("包含情绪/关系词，但可能是商业或内容语境");
  const negativeEvidence = prototype?.anti.filter((term) => containsTerm(text, term)).slice(0, 4) ?? [];
  return { positiveEvidence, negativeEvidence, conflictingEvidence };
}

function buildClassificationReason(candidate: ClassificationCandidate, evidence: EvidenceBundle, intentReason: string, confidence: ClassificationConfidence): string {
  const positive = evidence.positiveEvidence.length ? `命中 ${evidence.positiveEvidence.slice(0, 4).join("、")}` : "根据标题、标签和备注的整体语义";
  const confidenceText = confidence === "low" ? "但信息不足，建议人工确认" : confidence === "medium" ? "判断为中等置信" : "判断较明确";
  return `${positive}，因此归为「${candidate.contentDomain} / ${candidate.contentSubDomain}」；${intentReason}${confidenceText ? ` ${confidenceText}。` : ""}`;
}

function extractClassificationKeywords(fields: FieldSeparatedText, candidate: ClassificationCandidate, intent: SavedIntent): string[] {
  const words = fields.textForClassification
    .split(/[\s,，。；;、|/《》【】#（）()！!？?]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && word.length <= 18 && !/^https?:/i.test(word));
  return unique([candidate.contentDomain, candidate.contentSubDomain, intent, ...fields.hashtags, ...candidate.reasons.flatMap((reason) => reason.split(/[：、]/)).slice(1), ...words]).slice(0, 14);
}

function extractClassificationEntities(fields: FieldSeparatedText, candidate: ClassificationCandidate): EntityTag[] {
  const prototype = prototypes.find((item) => item.domain === candidate.contentDomain && item.subDomain === candidate.contentSubDomain);
  const text = fields.textForClassification;
  const values = prototype ? unique([...prototype.strong, ...prototype.terms].filter((term) => containsTerm(text, term))).slice(0, 8) : [];
  return values.map((value) => ({ type: prototype?.entityType ?? "topic", value }));
}

function toCandidates(map: Map<string, { prototype: Prototype; score: number; reasons: string[] }>): ClassificationCandidate[] {
  const sorted = [...map.values()]
    .sort((a, b) => b.score - a.score || a.prototype.domain.localeCompare(b.prototype.domain, "zh-CN"))
    .map((entry) => ({
      contentDomain: entry.prototype.domain,
      contentSubDomain: entry.prototype.subDomain,
      score: Math.round(Math.max(0, entry.score) * 100) / 100,
      reasons: entry.reasons.filter(Boolean)
    }));
  return sorted[0]?.score > 0 ? sorted : [{ contentDomain: "暂存", contentSubDomain: "待确认分类", score: 0, reasons: ["信息不足"] }, ...sorted.slice(1)];
}

function applyCorrectionBoost(map: Map<string, { prototype: Prototype; score: number; reasons: string[] }>, text: string, corrections: ClassificationCorrection[], boost: number) {
  corrections.forEach((correction) => {
    const similarity = overlapScore(text, correction.textSnapshot);
    if (similarity < 0.22) return;
    const key = keyOf(correction.correctedDomain, correction.correctedSubDomain);
    const entry = map.get(key);
    if (!entry) return;
    entry.score += boost * similarity;
    entry.reasons.push("参考了过往人工纠正");
  });
}

function correctionSimilarity(text: string, corrections: ClassificationCorrection[], domain: ContentDomain, subDomain: string): number {
  return corrections
    .filter((correction) => correction.correctedDomain === domain && correction.correctedSubDomain === subDomain)
    .reduce((best, correction) => Math.max(best, overlapScore(text, correction.textSnapshot)), 0);
}

function boostDomain(map: Map<string, { prototype: Prototype; score: number; reasons: string[] }>, domain: ContentDomain, amount: number, reason: string) {
  map.forEach((entry) => {
    if (entry.prototype.domain === domain) {
      entry.score += amount;
      entry.reasons.push(reason);
    }
  });
}

function penalizeDomain(map: Map<string, { prototype: Prototype; score: number; reasons: string[] }>, domain: ContentDomain, amount: number, reason: string) {
  map.forEach((entry) => {
    if (entry.prototype.domain === domain) {
      entry.score -= amount;
      entry.reasons.push(reason);
    }
  });
}

function p(domain: ContentDomain, subDomain: string, description: string, entityType: string, strong: string[], terms: string[], examples: string[], anti: string[]): Prototype {
  return { domain, subDomain, description, entityType, strong, terms, examples, anti };
}

function keyOf(domain: ContentDomain, subDomain: string): string {
  return `${domain}:${subDomain}`;
}

function containsTerm(text: string, term: string): boolean {
  return text.toLocaleLowerCase().includes(term.toLocaleLowerCase());
}

function tokenize(text: string): string[] {
  const normalized = text.toLocaleLowerCase();
  const words = normalized.split(/[\s,，。；;、|/《》【】#（）()！!？?]+/).filter((word) => word.length >= 2);
  const chars = [...normalized.replace(/\s+/g, "")].filter((char) => /[\p{L}\p{N}]/u.test(char));
  const bigrams = chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  return unique([...words, ...bigrams]);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = [...setA].filter((item) => setB.has(item)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function overlapScore(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}

function cleanField(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\uFEFF\u00AD]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHashtags(value: string): string[] {
  return [...value.matchAll(/#([\p{L}\p{N}_-]{2,24})/gu)].map((match) => match[1]);
}

function extractTitleFromText(value: string): string {
  const clean = cleanField(value.replace(/https?:\/\/\S+/g, " "));
  const bracket = clean.match(/[【\[]([^】\]]+)[】\]]/);
  if (bracket?.[1]) return bracket[1].replace(/\s+[-—–].*$/, "").trim();
  return clean.replace(/^\d+\s*/, "").split(/[｜|]/)[0]?.replace(/\s+[-—–]\s+.*$/, "").slice(0, 80).trim() ?? "";
}

function extractAuthor(value: string): string {
  const match = value.match(/[-—–]\s*([^|｜】]+)\s*[|｜]\s*小红书/);
  return match?.[1]?.trim() ?? "";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
