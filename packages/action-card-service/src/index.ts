import type { ActionCard, Category, Plan, PlanType, SavedIntent, SavedItem, SmartAlbum, SmartAlbumMatchProfile, SmartAlbumPriority, Task } from "@revival/shared-types";

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  learning: "学习计划",
  travel: "出行计划",
  recipe: "饮食计划",
  workflow: "工作流计划",
  life: "生活计划",
  creative: "创作计划",
  mixed: "混合计划"
};

const categoryPlanType: Record<Category, PlanType> = {
  内容创作: "creative",
  "AI 与效率": "workflow",
  技能学习: "learning",
  工作与职业: "workflow",
  商业与经营: "workflow",
  出行与探店: "travel",
  饮食与健康: "recipe",
  生活与家居: "life",
  穿搭与消费: "life",
  情绪与关系: "life",
  读书与思考: "learning",
  暂存: "mixed"
};

export function getPlanTypeForCategory(category: Category): PlanType {
  return categoryPlanType[category] ?? "mixed";
}

export function findActionCardBySavedItem(actionCards: ActionCard[], savedItemId: string): ActionCard | undefined {
  return actionCards.find((card) => card.savedItemId === savedItemId);
}

export function createPlansFromActionCards(_userId: string, _savedItems: SavedItem[], _actionCards: ActionCard[], _now = new Date()): Plan[] {
  return [];
}

function buildPlan(userId: string, type: PlanType, cards: ActionCard[], savedItems: SavedItem[], now: Date): Plan {
  const durationDays = pickDuration(cards.length);
  const title = `${durationDays}天${PLAN_TYPE_LABELS[type]}`;
  const sortedCards = [...cards].sort((a, b) => {
    const itemA = savedItems.find((item) => item.id === a.savedItemId);
    const itemB = savedItems.find((item) => item.id === b.savedItemId);
    return new Date(itemB?.createdAt ?? b.createdAt).getTime() - new Date(itemA?.createdAt ?? a.createdAt).getTime();
  });

  const tasks = sortedCards.flatMap((card, cardIndex) =>
    card.tasks.slice(0, 3).map((task, taskIndex) => ({
      ...task,
      id: `plan_${type}_${card.id}_${taskIndex}`,
      dueDate: addDays(now, Math.min(durationDays - 1, cardIndex + taskIndex)).toISOString()
    }))
  );

  return {
    id: `plan_${type}`,
    userId,
    title,
    type,
    durationDays,
    description: buildPlanDescription(type, sortedCards.length),
    actionCardIds: sortedCards.map((card) => card.id),
    tasks,
    status: "not_started",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function pickDuration(cardCount: number): 3 | 7 | 30 {
  if (cardCount <= 2) return 3;
  if (cardCount <= 6) return 7;
  return 30;
}

function buildPlanDescription(type: PlanType, count: number): string {
  if (type === "travel") return `把 ${count} 张出行或探店卡整理成可执行的短途清单。`;
  if (type === "recipe") return `从 ${count} 张饮食卡里挑出最近能做、能练的一小步。`;
  if (type === "workflow") return `把 ${count} 张效率卡压缩成可复用 SOP。`;
  if (type === "creative") return `把 ${count} 张创作卡转成选题、封面或内容动作。`;
  return `把 ${count} 张${PLAN_TYPE_LABELS[type]}行动卡排进一个轻量执行节奏。`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function cloneTasksForCard(cardId: string, drafts: Array<Omit<Task, "id" | "actionCardId" | "order" | "status">>): Task[] {
  return drafts.map((draft, index) => ({
    id: `task_${cardId}_${index + 1}`,
    actionCardId: cardId,
    title: draft.title,
    description: draft.description,
    estimatedTime: draft.estimatedTime,
    dueDate: draft.dueDate,
    status: "not_started",
    order: index + 1
  }));
}

type AlbumCluster = {
  key: string;
  albumView: "content_domain" | "saved_intent";
  category: Category;
  subCategory: string;
  savedIntent?: SavedIntent;
  items: SavedItem[];
  keywords: string[];
};

const albumTitleByCategory: Record<Category, string[]> = {
  内容创作: ["视频剪辑和内容制作", "封面标题和选题素材", "小红书图文创作灵感"],
  "AI 与效率": ["AI Prompt 和决策辅助", "效率工作流复现清单", "可复制工具方法"],
  技能学习: ["最近最想学会的技能", "一次只练一个小动作", "技能入门练习清单"],
  工作与职业: ["招聘求职和团队机会", "值得后续联系的职业线索", "职场成长和工作方法"],
  商业与经营: ["商业案例和经营方法", "独立站与跨境经营", "选品定价和变现参考"],
  出行与探店: ["周末展览和城市去处", "想去的城市和路线", "探店与展览候选"],
  饮食与健康: ["低卡饮食与备餐", "今天可以开始的饮食小计划", "健康练习清单"],
  生活与家居: ["把家里一个角落整理好", "租房改造和收纳计划", "周末生活改造"],
  穿搭与消费: ["少花钱也能试试的风格", "理性种草和替代清单", "穿搭消费参考"],
  情绪与关系: ["情绪表达与关系沟通", "值得写进复盘的关系观察", "自我观察记录"],
  读书与思考: ["值得继续追问的观点", "读书笔记和思考线索", "把观点写成自己的话"],
  暂存: ["需要补一句备注的收藏", "待判断的旧线索", "先别急着整理完"]
};

const albumTitleByIntent: Record<SavedIntent, string> = {
  想学习: "最近想学会的东西",
  想复现: "可以复现的教程",
  想去: "想去的地方",
  想买: "想买但还没决定的东西",
  想做: "可以照着做一次",
  内容创作参考: "可以写成内容的灵感",
  工作决策参考: "工作决策参考",
  求职关注: "求职和岗位线索",
  创业团队参考: "创业团队和合作机会",
  以后联系: "后续可能要联系的人和机会",
  商业案例参考: "值得拆解的商业案例",
  情绪共鸣: "值得写进手帐或复盘",
  以后查阅: "只是想以后再看的内容",
  暂时保存: "待补充用途的收藏"
};

export function generateSmartAlbums(savedItems: SavedItem[], now = new Date()): SmartAlbum[] {
  const activeItems = dedupeItems(savedItems).filter((item) => item.status !== "completed" && item.status !== "snoozed");
  const clusters = buildAlbumClusters(activeItems);
  return clusters
    .map((cluster) => buildSmartAlbum(cluster, now))
    .sort((a, b) => b.priorityScore - a.priorityScore || b.savedItemIds.length - a.savedItemIds.length)
    .slice(0, 12);
}

function buildAlbumClusters(items: SavedItem[]): AlbumCluster[] {
  const domainGroups = new Map<string, SavedItem[]>();
  const intentGroups = new Map<string, SavedItem[]>();
  const lowConfidenceItems: SavedItem[] = [];

  items.forEach((item) => {
    const domain = normalizeRuntimeCategory(item.contentDomain ?? item.category);
    const subDomain = item.contentSubDomain || item.subCategory || item.keywords[0] || "主题整理";
    if (item.confidence === "low" || item.classificationConfidence === "low" || domain === "暂存") {
      lowConfidenceItems.push(item);
    } else {
      const domainKey = `${domain}:${subDomain}`;
      domainGroups.set(domainKey, [...(domainGroups.get(domainKey) ?? []), item]);
    }

    const intent = normalizeSavedIntent(item.savedIntent || item.intent);
    const intentKey = `intent:${intent}`;
    intentGroups.set(intentKey, [...(intentGroups.get(intentKey) ?? []), item]);
  });

  const domainClusters = [...domainGroups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([key, group]) => buildCluster(key, "content_domain", group));
  const lowConfidenceCluster = lowConfidenceItems.length > 0 ? [buildCluster("暂存:待确认分类", "content_domain", lowConfidenceItems)] : [];
  const intentClusters = [...intentGroups.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([key, group]) => buildCluster(key, "saved_intent", group));
  return [...domainClusters, ...lowConfidenceCluster, ...intentClusters].filter((cluster) => cluster.items.length > 0);
}

function buildCluster(key: string, albumView: "content_domain" | "saved_intent", group: SavedItem[]): AlbumCluster {
  const sortedItems = [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const first = sortedItems[0];
  const category = key.startsWith("暂存:") ? "暂存" : normalizeRuntimeCategory(first.contentDomain ?? first.category);
  const savedIntent = normalizeSavedIntent(first.savedIntent || first.intent);
  const keywords = pickAlbumKeywords(sortedItems);
  return {
    key,
    albumView,
    category,
    subCategory: key.startsWith("暂存:") ? "待确认分类" : albumView === "saved_intent" ? savedIntent : first.contentSubDomain || first.subCategory || keywords[0] || "主题整理",
    savedIntent: albumView === "saved_intent" ? savedIntent : undefined,
    items: sortedItems,
    keywords
  };
}

function buildSmartAlbum(cluster: AlbumCluster, now: Date): SmartAlbum {
  const createdAt = now.toISOString();
  const recommended = cluster.items.slice(0, 3);
  const title = pickAlbumTitle(cluster);
  const priorityScore = cluster.items.length * 12 + cluster.keywords.length * 3 + (cluster.category === "暂存" ? -8 : 0) + (cluster.albumView === "saved_intent" ? 3 : 0);
  const priority: SmartAlbumPriority = priorityScore >= 36 ? "high" : priorityScore >= 18 ? "medium" : "low";
  const matchProfile = buildMatchProfile(cluster);

  return {
    id: `album_${cluster.albumView}_${slugify(cluster.savedIntent ?? cluster.category)}_${slugify(cluster.subCategory)}_${slugify(cluster.keywords[0] ?? cluster.key)}`,
    title,
    description: cluster.albumView === "saved_intent"
      ? `从 ${cluster.items.length} 条“${cluster.savedIntent}”用途的收藏里整理出的视角，先挑 3 条最值得复活。`
      : `从 ${cluster.items.length} 条「${cluster.subCategory}」主题收藏里整理出的视角，先复活最值得开始的 3 条。`,
    albumView: cluster.albumView,
    contentDomain: cluster.category,
    contentSubDomain: cluster.albumView === "content_domain" ? cluster.subCategory : undefined,
    savedIntent: cluster.savedIntent,
    category: cluster.category,
    albumType: cluster.albumView === "saved_intent" ? "intent_album" : inferAlbumType(cluster.category, cluster.subCategory),
    keywords: cluster.keywords,
    savedItemIds: cluster.items.map((item) => item.id),
    recommendedItemIds: recommended.map((item) => item.id),
    coverItemId: recommended[0]?.id,
    whyThisAlbum: buildWhyThisAlbum(cluster),
    whyStartHere: recommended[0] ? `先从「${recommended[0].title}」开始，因为它最近保存、信息更完整，比较容易判断要不要复活。` : "先挑信息最完整的一条开始。",
    suggestedFirstAction: buildSuggestedFirstAction(cluster.category, cluster.subCategory, cluster.savedIntent),
    priority,
    priorityScore,
    status: "candidate",
    autoCollectEnabled: false,
    mediumMatchRequiresApproval: true,
    matchProfile,
    suggestedItemIds: [],
    manuallyAddedItemIds: [],
    manuallyRemovedItemIds: [],
    schemaVersion: 2,
    createdAt,
    updatedAt: createdAt
  };
}

function buildMatchProfile(cluster: AlbumCluster): SmartAlbumMatchProfile {
  const entityValues = new Set<string>();
  cluster.items.forEach((item) => item.entities.forEach((entity) => entityValues.add(entity.value)));
  return {
    contentDomain: cluster.albumView === "content_domain" ? cluster.category : undefined,
    contentSubDomain: cluster.albumView === "content_domain" ? cluster.subCategory : undefined,
    savedIntent: cluster.albumView === "saved_intent" ? cluster.savedIntent : undefined,
    keywords: cluster.keywords.slice(0, 10),
    entityValues: [...entityValues].slice(0, 12),
    positiveExamples: cluster.items.slice(0, 5).map((item) => item.id),
    negativeExamples: []
  };
}

function pickAlbumKeywords(items: SavedItem[]): string[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    [item.contentSubDomain || item.subCategory, item.savedIntent, ...(item.secondaryIntents ?? []), ...item.keywords, ...item.entities.map((entity) => entity.value)]
      .map((keyword) => String(keyword || "").trim())
      .filter((keyword) => keyword.length >= 2 && keyword.length <= 18)
      .forEach((keyword) => counts.set(keyword, (counts.get(keyword) ?? 0) + 1));
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([keyword]) => keyword).slice(0, 8);
}

function pickAlbumTitle(cluster: AlbumCluster): string {
  if (cluster.albumView === "saved_intent" && cluster.savedIntent) return albumTitleByIntent[cluster.savedIntent];
  const primary = cluster.keywords.find((keyword) => keyword !== cluster.subCategory) ?? cluster.subCategory;
  if (primary && cluster.category === "AI 与效率") return `${primary}：AI Prompt 和效率方法`;
  if (primary && cluster.category === "内容创作") return `${primary}：内容制作素材`;
  if (primary && cluster.category === "工作与职业") return `${primary}：职业机会和工作线索`;
  if (primary && cluster.category === "商业与经营") return `${primary}：商业经营参考`;
  if (primary && cluster.category === "情绪与关系") return `${primary}：关系和自我观察`;
  if (primary && cluster.category === "出行与探店") return `${primary}：周末可以去哪里`;
  if (primary && cluster.category === "饮食与健康") return `${primary}：先做一份清单`;
  return albumTitleByCategory[cluster.category]?.[0] ?? `${cluster.subCategory || "待补充备注"}：先复活 3 条`;
}

function buildWhyThisAlbum(cluster: AlbumCluster): string {
  if (cluster.albumView === "saved_intent") return `这些收藏的用途都接近“${cluster.savedIntent}”，但内容主题可以不同，所以放在用途视角里一起看。`;
  return `这些收藏内容本身都围绕“${cluster.category} / ${cluster.subCategory}”，用途可以不同，但主题适合一起整理。`;
}

function inferAlbumType(category: Category, subCategory: string): string {
  if (category === "内容创作") return "creative_theme";
  if (category === "AI 与效率") return "workflow_theme";
  if (category === "工作与职业") return "career_theme";
  if (category === "商业与经营") return "business_theme";
  if (category === "技能学习") return "learning_theme";
  if (category === "出行与探店") return subCategory.includes("探店") ? "shop_theme" : "travel_theme";
  if (category === "饮食与健康") return "recipe_health_theme";
  if (category === "暂存") return "needs_note";
  return "life_theme";
}

function buildSuggestedFirstAction(category: Category, subCategory: string, savedIntent?: SavedIntent): string {
  if (savedIntent === "内容创作参考") return "先挑一条，决定它是借鉴标题、封面、结构还是观点，再生成行动卡。";
  if (savedIntent === "工作决策参考") return "先挑一条最贴近当前工作的收藏，生成一张用于今天决策的小行动卡。";
  if (savedIntent === "求职关注") return "先挑一条岗位或团队机会，确认角色、地点、要求和下一步联系动作。";
  if (savedIntent === "创业团队参考") return "先挑一条团队机会，判断它和你的城市、能力、时间是否匹配。";
  if (savedIntent === "商业案例参考") return "先挑一条商业案例，记录它的用户、产品、定价和可复用判断。";
  if (savedIntent === "想复现") return "先挑一条教程，选择“照着做一次”，只复现第一步。";
  if (category === "内容创作") return "先打开推荐的第一条，判断它适合做选题、封面还是脚本参考。";
  if (category === "AI 与效率") return "先选择一个工具或 Prompt，用在今天真实工作的一小步里。";
  if (category === "工作与职业") return "先确认岗位、团队、城市和联系入口，再决定要不要跟进。";
  if (category === "商业与经营") return "先记录这个案例的产品、客单价、获客方式和可借鉴点。";
  if (category === "出行与探店") return "先确认地点、时间、交通和预算，再放进一个候选日期。";
  if (category === "饮食与健康") return "先抄出食材或动作清单，标记今天能不能做。";
  if (category === "情绪与关系") return "先摘出一句最触动的观点，再写一个自己的例子。";
  return `先补一句为什么收藏这组“${subCategory}”，再决定要不要复活。`;
}

function normalizeSavedIntent(value: unknown): SavedIntent {
  if (value === "想学习" || value === "想复现" || value === "想去" || value === "想买" || value === "想做" || value === "内容创作参考" || value === "工作决策参考" || value === "求职关注" || value === "创业团队参考" || value === "以后联系" || value === "商业案例参考" || value === "情绪共鸣" || value === "以后查阅" || value === "暂时保存") return value;
  const text = String(value ?? "");
  if (/招聘|求职|岗位|简历|面试/.test(text)) return "求职关注";
  if (/创业团队|合伙人|加入公司|以后联系/.test(text)) return "创业团队参考";
  if (/商业案例|独立站|跨境|选品|定价|客单价|毛利/.test(text)) return "商业案例参考";
  if (/创作|选题|封面|内容/.test(text)) return "内容创作参考";
  if (/工作|决策|效率|SOP|流程|自动化/.test(text)) return "工作决策参考";
  if (/复现|照着|模仿/.test(text)) return "想复现";
  if (/学习|教程|练习/.test(text)) return "想学习";
  if (/旅行|路线|探店|展览|去/.test(text)) return "想去";
  if (/买|购物|种草|消费/.test(text)) return "想买";
  if (/情绪|关系|共鸣/.test(text)) return "情绪共鸣";
  return "以后查阅";
}
function dedupeItems(items: SavedItem[]): SavedItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.sourceUrl.trim().toLowerCase() || item.title.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeRuntimeCategory(value: unknown): Category {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(categoryPlanType, value) ? value as Category : "暂存";
}

function slugify(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "").slice(0, 32).toLowerCase() || "untitled";
}
