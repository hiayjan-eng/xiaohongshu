import type { ContentDomain } from "@revival/shared-types";
import { classifyCollectionInput, type ClassificationInput } from "./index";

export interface ClassificationEvalFixture {
  id: string;
  input: ClassificationInput;
  expectedDomain: ContentDomain;
  expectedSubDomain?: string | RegExp;
  allowDomains?: ContentDomain[];
}

export interface ClassificationEvalReport {
  total: number;
  domainAccuracy: number;
  subDomainAccuracy: number;
  top3DomainAccuracy: number;
  tempStoreRatio: number;
  highConfidenceErrorRate: number;
  confusionMatrix: Record<string, Record<string, number>>;
  failed重点Cases: string[];
}

export const classificationEvalFixtures: ClassificationEvalFixture[] = [
  f("career-founder-hiring", "欢迎大家加入我的创业公司（广深优先）", "招聘、招人、加入公司，广深优先，全职岗位", "工作与职业", /招聘求职|创业团队/),
  f("business-emotion-premium", "拆解一个赚钱的独立站，几块串珠卖出10倍情绪溢价", "#独立站运营 #跨境选品 #产品", "商业与经营", /独立站运营|选品与定价|跨境电商/),
  f("career-shenzhen-content", "深圳公司招聘内容运营", "岗位、薪资、面试、办公地点", "工作与职业", /招聘求职/),
  f("business-emotion-value", "情绪价值如何提高商品客单价", "产品定价、品牌营销、转化率和溢价", "商业与经营", /选品与定价|品牌营销/),
  f("emotion-needs", "如何在关系中表达自己的需求", "亲密关系沟通，边界感和安全感", "情绪与关系", /亲密关系/),
  f("travel-shenzhen-weekend", "深圳周末展览路线", "展览、咖啡、路线和门票", "出行与探店", /展览活动|周末去处/),
  f("creative-ai-cut", "AI 剪辑视频教程", "短视频剪辑，AI 辅助生成字幕和转场", "内容创作", /视频剪辑/),
  f("ai-roundtable", "多角色 Prompt 帮我做战略决策", "Jung、Mankiw、Munger、Musk 圆桌 prompt", "AI 与效率", /Prompt 工程|决策辅助/),
  f("career-crossborder-hiring", "独立站招聘跨境运营", "岗位招聘，跨境运营，深圳优先", "工作与职业", /招聘求职/),
  f("business-team-incentive", "创业公司如何做员工激励", "团队管理、股权激励、商业经营案例", "商业与经营", /创业经营|商业模式/, ["商业与经营", "工作与职业"]),
  f("creative-cover", "小红书封面设计技巧", "标题、封面、图文排版和账号内容参考", "内容创作", /封面设计/),
  f("creative-topic", "30 个生活方式账号选题方向", "账号定位、系列内容、爆款标题", "内容创作", /选题策划|小红书运营/),
  f("creative-copy", "种草文案开头 20 个模板", "文案素材、标题和行动号召", "内容创作", /文案写作|选题策划/),
  f("creative-shooting", "手机拍摄角度和运镜灵感", "拍摄脚本、构图、短视频参考", "内容创作", /视频剪辑|拍摄脚本/),
  f("creative-account", "小红书账号运营复盘模板", "账号运营、数据复盘和封面优化", "内容创作", /小红书运营|账号复盘/),
  f("ai-codex", "3个方法，让codex帮你猛猛干活！！", "AI 编程、Codex、工作流和自动化效率", "AI 与效率", /AI工具|自动化工作流/),
  f("ai-notion", "Notion AI 自动整理会议纪要", "办公效率、自动化工作流", "AI 与效率", /自动化工作流|办公效率/),
  f("ai-excel", "Excel + ChatGPT 做周报", "AI工具、表格总结、工作流", "AI 与效率", /AI工具|办公效率/),
  f("ai-prompt-writing", "提示词模板：让 Claude 帮我改方案", "Prompt 工程，结构化输出", "AI 与效率", /Prompt 工程/),
  f("ai-agent", "智能体帮我拆项目任务", "AI agent、项目管理、自动化", "AI 与效率", /自动化工作流|AI工具/),
  f("skill-english", "英语口语 14 天影子跟读练习", "英语学习、跟读、复述", "技能学习", /语言学习|技能练习/),
  f("skill-photo", "手机摄影自然光构图训练", "摄影入门、构图和调色", "技能学习", /摄影修图|技能练习/),
  f("skill-code", "TypeScript 泛型入门练习", "编程教程、练习题", "技能学习", /编程学习|课程教程/),
  f("skill-design", "Figma 自动布局教程", "设计学习、入门课程", "技能学习", /设计学习|课程教程/),
  f("skill-writing", "写作练习：把生活观察写成笔记", "写作教程、故事结构", "技能学习", /技能练习|课程教程/),
  f("career-resume", "简历项目经历怎么写更有结果感", "求职、面试、简历优化", "工作与职业", /招聘求职/),
  f("career-interview", "产品经理面试 10 个高频问题", "岗位、面试、求职", "工作与职业", /招聘求职/),
  f("career-freelance", "自由职业者如何找长期客户", "自由职业、客户、收入", "工作与职业", /自由职业/),
  f("career-side", "下班后做副业的时间安排", "副业探索、工作方法", "工作与职业", /副业探索|工作方法/),
  f("career-method", "一页纸工作汇报方法", "职场成长、汇报、向上管理", "工作与职业", /工作方法|职场成长/),
  f("business-shopify", "Shopify 独立站转化率优化", "独立站运营、落地页、转化率", "商业与经营", /独立站运营/),
  f("business-tiktok", "TikTok Shop 爆品选品逻辑", "跨境电商、选品、供应链", "商业与经营", /跨境电商|选品与定价/),
  f("business-price", "低成本产品怎么做高溢价", "定价、毛利、客单价", "商业与经营", /选品与定价/),
  f("business-brand", "小品牌如何做第一波种子用户", "品牌营销、获客、复购", "商业与经营", /品牌营销|销售与变现/),
  f("business-store", "社区咖啡店如何提升复购", "门店经营、客单价、复购", "商业与经营", /门店经营|销售与变现/),
  f("travel-dali", "大理 3 天慢旅行路线", "洱海、喜洲、交通和预算", "出行与探店", /旅行攻略|城市路线/),
  f("travel-coffee", "广州安静咖啡店 brunch 探店", "咖啡店、人均、营业时间", "出行与探店", /咖啡餐厅/),
  f("travel-hiking", "杭州周边徒步一日路线", "交通、补给、徒步", "出行与探店", /徒步周边|旅行攻略/),
  f("travel-shanghai", "上海近期展览清单", "美术馆、展览、周末活动", "出行与探店", /展览活动/),
  f("travel-market", "成都夜市小吃路线", "小吃、夜市、人均", "出行与探店", /咖啡餐厅|城市路线/),
  f("food-lowcal", "低卡晚餐备餐", "鸡胸肉、蔬菜、购物清单", "饮食与健康", /家常备餐|低卡饮食/),
  f("food-breakfast", "10 分钟高蛋白早餐", "鸡蛋、酸奶、燕麦", "饮食与健康", /早餐轻食|家常备餐/),
  f("food-airfryer", "空气炸锅鸡胸肉便当", "菜谱、便当、食材", "饮食与健康", /家常备餐|低卡饮食/),
  f("health-run", "跑步新手 4 周计划", "运动、训练计划", "饮食与健康", /健身运动/),
  f("health-yoga", "久坐肩颈拉伸动作", "拉伸、体态、组数", "饮食与健康", /健身运动/),
  f("home-closet", "衣柜换季收纳整理法", "收纳、断舍离、衣柜", "生活与家居", /收纳整理/),
  f("home-rent", "租房改造低预算氛围布置", "软装、灯光、地毯", "生活与家居", /租房改造/),
  f("home-kitchen", "厨房清洁周末 30 分钟流程", "清洁、台面、水槽", "生活与家居", /收纳整理|清洁流程/),
  f("home-desk", "桌面收纳让工作区不乱", "桌面、收纳、整理", "生活与家居", /收纳整理/),
  f("home-light", "小房间灯光布置", "家居布置、氛围", "生活与家居", /家居布置|租房改造/),
  f("style-commute", "夏天通勤穿搭公式", "穿搭、单品、风格关键词", "穿搭与消费", /穿搭风格/),
  f("style-skincare", "敏感肌护肤品避雷清单", "护肤、测评、避雷", "穿搭与消费", /护肤美妆|购物参考/),
  f("style-bag", "通勤包测评：轻便大容量", "单品、品牌、价格", "穿搭与消费", /购物参考/),
  f("style-makeup", "低成本淡妆步骤", "妆容、单品、替代", "穿搭与消费", /护肤美妆|穿搭风格/),
  f("style-alt", "法式风格平替单品", "穿搭、平替、购物参考", "穿搭与消费", /购物参考|穿搭风格/),
  f("emotion-boundary", "亲密关系里的边界感", "伴侣沟通、安全感", "情绪与关系", /亲密关系/),
  f("emotion-anxiety", "焦虑的时候怎么写复盘", "情绪、手帐、自我观察", "情绪与关系", /情绪成长|自我观察/),
  f("emotion-sensitive", "把敏感还给自己", "情绪成长、内耗、觉察", "情绪与关系", /情绪成长/),
  f("emotion-conflict", "吵架后如何温和表达不满", "关系、表达需求、沟通", "情绪与关系", /亲密关系|沟通表达/),
  f("book-note", "《置身事内》读书笔记", "书籍、摘抄、观点", "读书与思考", /读书笔记/),
  f("book-model", "芒格的逆向思维模型", "认知模型、观点思考", "读书与思考", /观点思考|认知模型/),
  f("book-list", "适合产品经理的 10 本书", "书单、读书、知识摘抄", "读书与思考", /读书笔记|知识摘抄/),
  f("stash-short", "84", "", "暂存", /待确认分类|待补充备注/),
  f("stash-missing", "先保存一下", "之后再看，不确定用途", "暂存", /待确认分类|待补充备注/)
];

export function evaluateClassificationFixtures(fixtures: ClassificationEvalFixture[] = classificationEvalFixtures): ClassificationEvalReport {
  let domainHits = 0;
  let subDomainHits = 0;
  let top3Hits = 0;
  let tempStoreCount = 0;
  let highConfidenceErrors = 0;
  const confusionMatrix: Record<string, Record<string, number>> = {};
  const failed重点Cases: string[] = [];

  fixtures.forEach((fixture, index) => {
    const result = classifyCollectionInput(fixture.input);
    const acceptedDomains = fixture.allowDomains ?? [fixture.expectedDomain];
    const domainOk = acceptedDomains.includes(result.contentDomain);
    const subOk = matchSubDomain(result.contentSubDomain, fixture.expectedSubDomain);
    const top3Ok = result.topCandidates.some((candidate) => acceptedDomains.includes(candidate.contentDomain));
    domainHits += domainOk ? 1 : 0;
    subDomainHits += domainOk && subOk ? 1 : 0;
    top3Hits += top3Ok ? 1 : 0;
    tempStoreCount += result.contentDomain === "暂存" ? 1 : 0;
    highConfidenceErrors += result.confidence === "high" && !domainOk ? 1 : 0;
    confusionMatrix[fixture.expectedDomain] ??= {};
    confusionMatrix[fixture.expectedDomain][result.contentDomain] = (confusionMatrix[fixture.expectedDomain][result.contentDomain] ?? 0) + 1;
    if (index < 10 && !domainOk) {
      failed重点Cases.push(`${fixture.id}: expected ${fixture.expectedDomain}, got ${result.contentDomain}/${result.contentSubDomain}`);
    }
  });

  const total = fixtures.length || 1;
  return {
    total: fixtures.length,
    domainAccuracy: round(domainHits / total),
    subDomainAccuracy: round(subDomainHits / total),
    top3DomainAccuracy: round(top3Hits / total),
    tempStoreRatio: round(tempStoreCount / total),
    highConfidenceErrorRate: round(highConfidenceErrors / total),
    confusionMatrix,
    failed重点Cases
  };
}

function f(id: string, title: string, rawShareText: string, expectedDomain: ContentDomain, expectedSubDomain?: string | RegExp, allowDomains?: ContentDomain[]): ClassificationEvalFixture {
  return {
    id,
    input: { sourceUrl: `https://www.xiaohongshu.com/explore/${id}`, title, rawShareText, userNote: "" },
    expectedDomain,
    expectedSubDomain,
    allowDomains
  };
}

function matchSubDomain(actual: string, expected?: string | RegExp): boolean {
  if (!expected) return true;
  return typeof expected === "string" ? actual === expected : expected.test(actual);
}

function round(value: number): number {
  return Math.round(value * 10000) / 100;
}

