import { test } from "@playwright/test";
import { generateSmartAlbums } from "../../../../packages/action-card-service/src/index";
import {
  classificationEvalFixtures,
  evaluateClassificationFixtures,
  type ClassificationEvalFixture
} from "../../../../packages/classification-service/src/eval-fixtures";
import { searchSavedItems } from "../../../../packages/search-service/src/index";
import type { Category, SavedItem } from "../../../../packages/shared-types/src/index";

const addedClassificationFixtures: ClassificationEvalFixture[] = [
  c("b065-ai-image", "ComfyUI 批量生成商品场景图", "节点工作流、提示词和模型参数", "AI 与效率", /AI 工具|自动化工作流/),
  c("b066-ai-code", "让 Claude Code 检查接口异常", "代码助手定位日志和修复建议", "AI 与效率", /AI 工具|软件教程/),
  c("b067-ai-meeting", "飞书 AI 自动整理访谈纪要", "会议转写、摘要和待办自动化", "AI 与效率", /自动化工作流|办公效率/),
  c("b068-creative-script", "探店短视频前三秒脚本", "开场钩子、分镜、口播节奏", "内容创作", /拍摄脚本|视频剪辑/),
  c("b069-creative-copy", "知识类笔记结尾怎么写", "文案结构、行动号召和评论互动", "内容创作", /文案写作|选题策划/),
  c("b070-career-offer", "两个 offer 应该怎么选", "薪资、成长空间、团队和城市比较", "工作与职业", /职业规划|职场成长|工作方法/),
  c("b071-career-remote", "远程自由职业报价清单", "长期客户、项目范围和收款节点", "工作与职业", /自由职业/),
  c("b072-business-store", "社区面包店会员复购方案", "门店经营、储值、客单价和复购", "商业与经营", /门店经营|销售与变现|商业模式/),
  c("b073-business-export", "外贸新手怎么核算 FOB 报价", "成本、运费、毛利和海外客户", "商业与经营", /跨境电商|选品与定价/),
  c("b074-skill-swim", "自由泳换气分解练习", "游泳入门、动作练习和常见错误", "技能学习", /技能练习|课程教程/),
  c("b075-skill-public", "五分钟即兴演讲训练", "表达练习、结构和复盘", "技能学习", /技能练习|课程教程/),
  c("b076-travel-hike", "深圳梧桐山轻松徒步线", "周末路线、登山口、补给和交通", "出行与探店", /徒步周边|旅行攻略|城市路线/),
  c("b077-travel-birthday", "杭州生日晚餐餐厅候选", "安静包间、人均、预约和氛围", "出行与探店", /咖啡餐厅/),
  c("b078-food-meal", "一周低脂便当备餐表", "菜谱、食材清单和分装保存", "饮食与健康", /家常备餐|低卡饮食/),
  c("b079-health-back", "久坐腰背疼的拉伸顺序", "居家训练、动作和组数", "饮食与健康", /健身运动/),
  c("b080-home-entry", "小户型玄关收纳动线", "鞋柜、钥匙、雨伞和回家动线", "生活与家居", /收纳整理|家居布置/),
  c("b081-home-fridge", "冰箱分区和每周清理表", "食材收纳、标签和清洁流程", "生活与家居", /收纳整理|清洁流程/),
  c("b082-style-color", "黄黑皮通勤配色公式", "穿搭、显白、基础款搭配", "穿搭与消费", /穿搭风格/),
  c("b083-style-sunscreen", "敏感肌通勤防晒实测", "护肤、成分、肤感和避雷", "穿搭与消费", /护肤美妆|购物参考/),
  c("b084-emotion-lonely", "独处和孤独感不是一回事", "心理观察、连接需求和自我觉察", "情绪与关系", /情绪成长|自我观察/),
  c("b085-emotion-parent", "怎么拒绝父母的过度安排", "家庭边界、沟通和内疚感", "情绪与关系", /沟通表达|亲密关系|情绪成长/),
  c("b086-stash-photo", "一张看不出内容的截图", "", "暂存", /待确认分类|待补充备注/),
  c("b087-stash-later", "有空再看", "没写为什么收藏", "暂存", /待确认分类|待补充备注/),
  c("b088-ai-vs-job", "招聘 AI 产品经理", "岗位要求、简历投递、北京办公", "工作与职业", /招聘求职/),
  c("b089-shop-vs-travel", "咖啡店如何提高翻台率", "门店经营、排队、客单价和复购", "商业与经营", /门店经营|商业模式/),
  c("b090-home-vs-product", "收纳盒值不值得买", "尺寸测评、价格、避雷和替代", "穿搭与消费", /购物参考|单品测评/),
  c("b091-creative-vs-job", "内容运营岗位面试作品集", "招聘、面试、简历和岗位要求", "工作与职业", /招聘求职/),
  c("b092-health-vs-brand", "瑜伽馆私域续费增长", "门店经营、会员复购和销售", "商业与经营", /门店经营|销售与变现/),
  c("b093-travel-vs-hiring", "成都民宿招店长", "招聘、薪资、岗位、包住", "工作与职业", /招聘求职/),
  c("b094-emotion-vs-price", "情绪价值产品怎么定价", "商品溢价、客单价、毛利", "商业与经营", /选品与定价/),
  c("b095-ai-vs-creative", "用 AI 做小红书动态封面", "内容创作、封面、视频和排版参考", "内容创作", /封面设计|视频剪辑/),
  c("b096-food-vs-store", "低卡餐外卖店选址模型", "门店经营、租金、客单价", "商业与经营", /门店经营|商业模式/),
  c("b097-skill-vs-job", "英语老师招聘试讲要求", "岗位、面试、薪资、试讲", "工作与职业", /招聘求职/),
  c("b098-travel-vs-home", "大理民宿房间软装改造", "灯光、地毯、家居布置", "生活与家居", /租房改造|家居布置/),
  c("b099-relationship-work", "和同事发生冲突怎么沟通", "职场、汇报、协作和边界", "工作与职业", /职场成长|工作方法/),
  c("b100-stash-code", "x7q", "复制这段文字，然后打开【小红书】看笔记", "暂存", /待确认分类|待补充备注/)
];

type AlbumScenario = {
  id: string;
  expectedGroup: boolean;
  domain: Category;
  subDomain: string;
  items: Array<{ title: string; keywords: string[]; entities?: string[] }>;
  requiredTitleTokens?: string[];
};

const albumScenarios: AlbumScenario[] = [
  a("a01-ai-image", true, "AI 与效率", "自动化工作流", [["ComfyUI 商品图批处理", "ComfyUI 商品图"], ["批量生成电商场景图", "ComfyUI 商品图"]], ["商品图", "ComfyUI"]),
  a("a02-shenzhen-hike", true, "出行与探店", "徒步周边", [["梧桐山轻松线", "深圳徒步"], ["七娘山周末路线", "深圳徒步"]], ["深圳", "徒步"]),
  a("a03-breakfast", true, "饮食与健康", "早餐轻食", [["高蛋白早餐", "早餐备餐"], ["隔夜燕麦组合", "早餐备餐"]], ["早餐"]),
  a("a04-codex", true, "AI 与效率", "AI 工具", [["Codex 整理需求", "Codex 项目"], ["Codex 拆任务", "Codex 项目"]], ["Codex"]),
  a("a05-birthday", true, "出行与探店", "咖啡餐厅", [["生日晚餐包间", "生日餐厅"], ["纪念日安静餐厅", "生日餐厅"]], ["生日", "餐厅"]),
  a("a06-closet", true, "生活与家居", "收纳整理", [["衣柜换季分区", "衣柜收纳"], ["衣柜断舍离", "衣柜收纳"]], ["衣柜"]),
  a("a07-cover", true, "内容创作", "封面设计", [["动态封面排版", "动态封面"], ["知识笔记封面", "动态封面"]], ["封面"]),
  a("a08-shopify", true, "商业与经营", "独立站运营", [["Shopify 结账优化", "Shopify 转化"], ["独立站落地页测试", "Shopify 转化"]], ["Shopify", "转化"]),
  a("a09-speaking", true, "技能学习", "语言学习", [["影子跟读训练", "英语口语"], ["通勤英语复述", "英语口语"]], ["英语", "口语"]),
  a("a10-boundary", true, "情绪与关系", "亲密关系", [["表达需求", "关系边界"], ["温和拒绝", "关系边界"]], ["关系", "边界"]),
  a("a11-running", true, "饮食与健康", "健身运动", [["跑步心率入门", "跑步训练"], ["首个五公里", "跑步训练"]], ["跑步"]),
  a("a12-rental", true, "生活与家居", "租房改造", [["出租屋灯光", "租房氛围"], ["免打孔墙面", "租房氛围"]], ["租房"]),
  a("a13-freelance", true, "工作与职业", "自由职业", [["项目报价模板", "自由职业报价"], ["长期客户合同", "自由职业报价"]], ["自由职业", "报价"]),
  a("a14-skincare", true, "穿搭与消费", "护肤美妆", [["敏感肌防晒", "通勤防晒"], ["轻薄防晒实测", "通勤防晒"]], ["防晒"]),
  a("a15-reject-ai", false, "AI 与效率", "AI 工具", [["ChatGPT 写周报", "周报"], ["Midjourney 婚礼插画", "婚礼"]]),
  a("a16-reject-travel", false, "出行与探店", "旅行攻略", [["大理亲子三日游", "亲子旅行"], ["东京中古店购物", "中古购物"]]),
  a("a17-reject-food", false, "饮食与健康", "家常备餐", [["空气炸锅鸡胸肉", "鸡胸肉"], ["儿童过敏原菜单", "过敏管理"]]),
  a("a18-reject-home", false, "生活与家居", "收纳整理", [["厨房调料收纳", "厨房"], ["搬家断舍离", "搬家"]]),
  a("a19-reject-work", false, "工作与职业", "工作方法", [["一页纸周报", "工作汇报"], ["设计师接单报价", "自由职业"]]),
  a("a20-reject-creative", false, "内容创作", "视频剪辑", [["探店运镜", "探店拍摄"], ["课程录屏字幕", "课程录屏"]])
];

type SearchFixture = {
  id: string;
  title: string;
  body: string;
  domain: Category;
  subDomain: string;
  query: string;
};

const searchFixtures: SearchFixture[] = [
  s("s01", "免剪辑生成三十秒动态海报", "用 Chatcut 图片转视频，关键帧和动效模板", "内容创作", "视频剪辑", "之前那个用 AI 做动态图的视频"),
  s("s02", "梧桐山泰山涧轻松线", "深圳登山口、补给点和下撤路线", "出行与探店", "徒步周边", "深圳周末能爬的山"),
  s("s03", "纪念日晚餐包间清单", "安静、有氛围、可预约，人均三百", "出行与探店", "咖啡餐厅", "适合生日吃饭的店"),
  s("s04", "独处时如何重新建立连接", "心理咨询师谈孤独、关系和自我觉察", "情绪与关系", "情绪成长", "讲孤独感的那篇"),
  s("s05", "用 Codex 做赛道资料树", "把行业报告按公司、产品和趋势整理", "AI 与效率", "AI 工具", "那个让 Codex 帮我整理行业的方法"),
  s("s06", "Chatcut 一键完成口播成片", "无需时间线，自动字幕、配图和转场", "内容创作", "视频剪辑", "不用剪辑软件做视频"),
  s("s07", "换季衣物四步归位法", "清空、筛选、分区、贴标签", "生活与家居", "收纳整理", "衣柜整理步骤"),
  s("s08", "周会内容自动变成待办", "飞书纪要连接 Notion 数据库", "AI 与效率", "自动化工作流", "开完会自动整理任务的工具"),
  s("s09", "黄黑皮基础色搭配表", "通勤衣橱用米白、藏蓝和棕色", "穿搭与消费", "穿搭风格", "上班显白的颜色怎么搭"),
  s("s10", "鸡胸肉分装冷冻计划", "周日两小时备好五天午餐", "饮食与健康", "家常备餐", "工作日减脂饭怎么提前准备"),
  s("s11", "和父母说不的三个句式", "家庭边界、内疚感和温和拒绝", "情绪与关系", "沟通表达", "不想被家里安排怎么说"),
  s("s12", "Shopify 结账页流失排查", "运费、支付方式和弃购邮件", "商业与经营", "独立站运营", "海外网站下单到一半都走了"),
  s("s13", "五分钟即兴表达练习", "结论先行、三个要点和录音复盘", "技能学习", "技能练习", "临时发言不紧张怎么练"),
  s("s14", "出租屋卧室分层照明", "落地灯、床头灯和色温搭配", "生活与家居", "租房改造", "租的房子晚上更有氛围"),
  s("s15", "敏感肌通勤防晒横评", "成膜速度、刺激性和补涂体验", "穿搭与消费", "护肤美妆", "脸容易泛红用哪款防晒"),
  s("s16", "自由职业项目报价拆分", "需求范围、修改轮次和付款节点", "工作与职业", "自由职业", "接私活不知道怎么报钱"),
  s("s17", "社区面包店储值复购", "会员日、次卡和新品试吃", "商业与经营", "门店经营", "小店怎么让老客再来"),
  s("s18", "大理雨季三天备用路线", "室内展馆、咖啡馆和交通方案", "出行与探店", "旅行攻略", "去大理碰上下雨怎么玩"),
  s("s19", "小红书知识封面信息层级", "主标题、副标题、留白和视觉动线", "内容创作", "封面设计", "知识类笔记封面别太乱"),
  s("s20", "自由泳侧头换气分解", "吐气节奏、身体滚转和单臂练习", "技能学习", "技能练习", "游泳一换气就下沉怎么办"),
  s("s21", "跑步新手心率区间", "能说完整句子的慢跑强度", "饮食与健康", "健身运动", "刚开始跑总是喘得厉害"),
  s("s22", "一页纸比较两个 Offer", "薪资、成长、老板和城市权重", "工作与职业", "职业规划", "两个工作机会纠结选哪个"),
  s("s23", "冰箱透明盒分区规则", "即食、待烹饪、调味和临期区", "生活与家居", "收纳整理", "冰箱里东西总过期怎么放"),
  s("s24", "低成本产品溢价拆解", "包装、场景、礼赠和客单价", "商业与经营", "选品与定价", "几块钱的东西为什么能卖很贵"),
  s("s25", "英语影子跟读十四天", "通勤十五分钟，逐句模仿语音语调", "技能学习", "语言学习", "每天坐地铁练口语的那个"),
  s("s26", "焦虑时的五格复盘", "触发事件、身体感受、想法、需要、行动", "情绪与关系", "自我观察", "心里很乱时怎么写下来"),
  s("s27", "探店短视频开场钩子", "前三秒先给结果，再交代地点和价格", "内容创作", "拍摄脚本", "拍餐厅视频开头说什么"),
  s("s28", "广州安静工作咖啡馆", "有插座、不赶客、工作日下午人少", "出行与探店", "咖啡餐厅", "能带电脑坐一下午的店"),
  s("s29", "晨会纪要自动归档 SOP", "语音转写后按项目写入飞书表格", "AI 与效率", "自动化工作流", "每天开会的记录自动分类"),
  s("s30", "一周内容选题复盘表", "按用户问题、标题钩子和数据表现回看", "内容创作", "账号复盘", "账号这周发什么效果好怎么复盘")
];

test("prints Phase 1 benchmark metrics", () => {
  const classification = evaluateClassificationFixtures([...classificationEvalFixtures, ...addedClassificationFixtures]);

  let albumExpectedMembers = 0;
  let albumCorrectMembers = 0;
  let albumMixedAlbums = 0;
  let albumGenerated = 0;
  let albumExpectedDecisions = 0;
  let albumDecisionHits = 0;
  let albumSpecificTitles = 0;
  let albumPositiveGenerated = 0;
  const albumDetails: Array<Record<string, unknown>> = [];

  for (const scenario of albumScenarios) {
    const items = scenario.items.map((item, index) => makeItem(`${scenario.id}-${index + 1}`, item.title, item.keywords.join(" "), scenario.domain, scenario.subDomain, item.keywords, item.entities ?? []));
    const albums = generateSmartAlbums(items, new Date("2026-07-29T00:00:00.000Z"));
    albumGenerated += albums.length;
    albumExpectedDecisions += 1;
    const grouped = albums.length > 0;
    if (grouped === scenario.expectedGroup) albumDecisionHits += 1;
    if (scenario.expectedGroup) {
      albumExpectedMembers += items.length;
      const first = albums[0];
      if (first) {
        albumPositiveGenerated += 1;
        albumCorrectMembers += first.savedItemIds.filter((id) => items.some((item) => item.id === id)).length;
        const tokens = scenario.requiredTitleTokens ?? [];
        if (tokens.some((token) => first.title.includes(token))) albumSpecificTitles += 1;
      }
    } else if (albums.length > 0) {
      albumMixedAlbums += albums.length;
    }
    albumDetails.push({ id: scenario.id, expectedGroup: scenario.expectedGroup, generated: albums.length, title: albums[0]?.title ?? "", size: albums[0]?.savedItemIds.length ?? 0 });
  }

  const corpus = searchFixtures.map((fixture, index) =>
    makeItem(fixture.id, fixture.title, fixture.body, fixture.domain, fixture.subDomain, keywordsFrom(fixture), [], index)
  );
  let top5Hits = 0;
  let exactTop1Hits = 0;
  let irrelevantTop3Slots = 0;
  let top3Slots = 0;
  const searchDetails = searchFixtures.map((fixture) => {
    const results = searchSavedItems(fixture.query, corpus, [], []);
    const rank = results.findIndex((result) => result.item.id === fixture.id) + 1;
    if (rank > 0 && rank <= 5) top5Hits += 1;
    const exact = searchSavedItems(fixture.title, corpus, [], []);
    if (exact[0]?.item.id === fixture.id) exactTop1Hits += 1;
    results.slice(0, 3).forEach((result) => {
      top3Slots += 1;
      if (result.item.id !== fixture.id) irrelevantTop3Slots += 1;
    });
    return { id: fixture.id, query: fixture.query, rank: rank || null, top3: results.slice(0, 3).map((result) => result.item.id), reasons: results.find((result) => result.item.id === fixture.id)?.matchReasons ?? [] };
  });

  console.log("V0_1_PHASE1_BENCHMARK_RESULT=" + JSON.stringify({
    classification,
    album: {
      scenarios: albumScenarios.length,
      decisionAccuracy: pct(albumDecisionHits, albumExpectedDecisions),
      membershipPrecision: pct(albumCorrectMembers, albumExpectedMembers + albumMixedAlbums * 2),
      crossTopicAlbumRate: pct(albumMixedAlbums, albumGenerated),
      specificTitleRate: pct(albumSpecificTitles, albumPositiveGenerated),
      generatedAlbums: albumGenerated,
      details: albumDetails
    },
    search: {
      queries: searchFixtures.length,
      top5Recall: pct(top5Hits, searchFixtures.length),
      exactTitleTop1: pct(exactTop1Hits, searchFixtures.length),
      irrelevantTop3SlotRate: pct(irrelevantTop3Slots, top3Slots),
      details: searchDetails
    }
  }, null, 2));
});

function c(id: string, title: string, rawShareText: string, expectedDomain: Category, expectedSubDomain: RegExp): ClassificationEvalFixture {
  return { id, input: { sourceUrl: `https://www.xiaohongshu.com/explore/${id}`, title, rawShareText, userNote: "" }, expectedDomain, expectedSubDomain };
}

function a(id: string, expectedGroup: boolean, domain: Category, subDomain: string, values: Array<[string, string]>, requiredTitleTokens: string[] = []): AlbumScenario {
  return { id, expectedGroup, domain, subDomain, items: values.map(([title, keyword]) => ({ title, keywords: [keyword] })), requiredTitleTokens };
}

function s(id: string, title: string, body: string, domain: Category, subDomain: string, query: string): SearchFixture {
  return { id, title, body, domain, subDomain, query };
}

function makeItem(id: string, title: string, body: string, domain: Category, subDomain: string, keywords: string[], entities: string[], index = 0): SavedItem {
  const createdAt = new Date(Date.UTC(2026, 6, 29, 0, 0, index)).toISOString();
  return {
    id,
    userId: "benchmark",
    sourcePlatform: "xiaohongshu",
    sourceUrl: `https://www.xiaohongshu.com/explore/${id}`,
    rawShareText: body,
    normalizedContentText: `${title} ${body}`,
    title,
    userNote: "",
    contentDomain: domain,
    contentSubDomain: subDomain,
    savedIntent: "以后查阅",
    secondaryIntents: [],
    confidence: "high",
    whyThisDomain: "人工标注",
    whyThisIntent: "人工标注",
    classificationReason: "人工标注",
    positiveEvidence: [],
    negativeEvidence: [],
    conflictingEvidence: [],
    dominantIntent: "以后查阅",
    category: domain,
    subCategory: subDomain,
    classificationConfidence: "high",
    intent: "以后查阅",
    whyThisCategory: "人工标注",
    summary: body,
    keywords,
    entities: entities.map((value) => ({ type: "topic", value, confidence: 1 })),
    searchableText: `${title} ${body} ${domain} ${subDomain} ${keywords.join(" ")}`,
    status: "not_started",
    createdAt,
    updatedAt: createdAt
  };
}

function keywordsFrom(fixture: SearchFixture): string[] {
  return fixture.body.split(/[、，,。和\s]+/).map((value) => value.trim()).filter((value) => value.length >= 2).slice(0, 5);
}

function pct(numerator: number, denominator: number): number {
  return denominator ? Math.round((numerator / denominator) * 10000) / 100 : 0;
}
