import type { ActionCard, Category, Plan, PlanType, SavedItem, SmartAlbum, SmartAlbumPriority, Task } from "@revival/shared-types";

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

export function createPlansFromActionCards(userId: string, savedItems: SavedItem[], actionCards: ActionCard[], now = new Date()): Plan[] {
  const activeItemIds = new Set(savedItems.filter((item) => item.status !== "completed" && item.status !== "snoozed").map((item) => item.id));
  const grouped = actionCards
    .filter((card) => activeItemIds.has(card.savedItemId))
    .reduce<Record<PlanType, ActionCard[]>>((groups, card) => {
      const type = getPlanTypeForCategory(card.category);
      groups[type] = groups[type] ?? [];
      groups[type].push(card);
      return groups;
    }, {} as Record<PlanType, ActionCard[]>);

  return Object.entries(grouped)
    .filter(([, cards]) => cards.length > 0)
    .map(([type, cards]) => buildPlan(userId, type as PlanType, cards, savedItems, now));
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
  category: Category;
  subCategory: string;
  items: SavedItem[];
  keywords: string[];
};

const albumTitleByCategory: Record<Category, string[]> = {
  内容创作: ["把内容灵感变成可发布选题", "小红书图文创作灵感", "封面标题和选题素材"],
  "AI 与效率": ["把 AI 工具真正用进日常工作", "效率工作流复现清单", "可复制 SOP 候选"],
  技能学习: ["最近最想学会的技能", "一次只练一个小动作", "技能入门练习清单"],
  出行与探店: ["这个周末可以去哪里", "想去的城市和路线", "探店与展览候选"],
  饮食与健康: ["低卡晚餐和备餐", "今天可以开始的饮食小计划", "健康练习清单"],
  生活与家居: ["把家里一个角落整理好", "租房改造和收纳计划", "周末生活改造"],
  穿搭与消费: ["少花钱也能试试的风格", "理性种草和替代清单", "穿搭消费参考"],
  情绪与关系: ["值得写进复盘的关系观察", "情绪和表达练习", "自我观察记录"],
  读书与思考: ["值得继续追问的观点", "读书笔记和思考线索", "把观点写成自己的话"],
  暂存: ["需要补一句备注的收藏", "待判断的旧线索", "先别急着整理完"]
};

export function generateSmartAlbums(savedItems: SavedItem[], now = new Date()): SmartAlbum[] {
  const activeItems = dedupeItems(savedItems).filter((item) => item.status !== "completed" && item.status !== "snoozed");
  const clusters = buildAlbumClusters(activeItems);
  return clusters
    .map((cluster) => buildSmartAlbum(cluster, now))
    .sort((a, b) => b.priorityScore - a.priorityScore || b.savedItemIds.length - a.savedItemIds.length)
    .slice(0, 8);
}

function buildAlbumClusters(items: SavedItem[]): AlbumCluster[] {
  const groups = new Map<string, SavedItem[]>();
  items.forEach((item) => {
    const theme = pickThemeKey(item);
    const key = `${item.category}:${theme}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return [...groups.entries()].map(([key, group]) => {
    const first = group[0];
    const keywords = pickAlbumKeywords(group);
    return {
      key,
      category: normalizeRuntimeCategory(first.category),
      subCategory: first.subCategory || keywords[0] || "主题整理",
      items: [...group].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
      keywords
    };
  });
}

function buildSmartAlbum(cluster: AlbumCluster, now: Date): SmartAlbum {
  const createdAt = now.toISOString();
  const recommended = cluster.items.slice(0, 3);
  const title = pickAlbumTitle(cluster);
  const priorityScore = cluster.items.length * 12 + cluster.keywords.length * 3 + (cluster.category === "暂存" ? -8 : 0);
  const priority: SmartAlbumPriority = priorityScore >= 36 ? "high" : priorityScore >= 18 ? "medium" : "low";

  return {
    id: `album_${slugify(cluster.category)}_${slugify(cluster.subCategory)}_${slugify(cluster.keywords[0] ?? cluster.key)}`,
    title,
    description: `从 ${cluster.items.length} 条「${cluster.subCategory}」收藏里整理出的主题，不需要一次处理完，先复活最值得开始的 3 条。`,
    category: cluster.category,
    albumType: inferAlbumType(cluster.category, cluster.subCategory),
    keywords: cluster.keywords,
    savedItemIds: cluster.items.map((item) => item.id),
    recommendedItemIds: recommended.map((item) => item.id),
    coverItemId: recommended[0]?.id,
    whyThisAlbum: `这些收藏都指向「${cluster.subCategory}」这个使用场景，适合合并成一个行动主题。`,
    whyStartHere: recommended[0] ? `先从「${recommended[0].title}」开始，因为它最近保存、信息更完整，比较容易行动。` : "先挑信息最完整的一条开始。",
    suggestedFirstAction: buildSuggestedFirstAction(cluster.category, cluster.subCategory),
    priority,
    priorityScore,
    status: "candidate",
    createdAt,
    updatedAt: createdAt
  };
}

function pickThemeKey(item: SavedItem): string {
  return item.subCategory || item.keywords[0] || item.category;
}

function pickAlbumKeywords(items: SavedItem[]): string[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    [item.subCategory, ...item.keywords, ...item.entities.map((entity) => entity.value)]
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length >= 2 && keyword.length <= 18)
      .forEach((keyword) => counts.set(keyword, (counts.get(keyword) ?? 0) + 1));
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([keyword]) => keyword).slice(0, 8);
}

function pickAlbumTitle(cluster: AlbumCluster): string {
  const primary = cluster.keywords[0];
  if (primary && cluster.category === "出行与探店") return `${primary}：这个周末可以去哪里`;
  if (primary && cluster.category === "饮食与健康") return `${primary}：先做一份清单`;
  if (primary && cluster.category === "内容创作") return `${primary}：变成一个可发布选题`;
  if (primary && cluster.category === "AI 与效率") return `${primary}：复现到日常工作里`;
  return albumTitleByCategory[cluster.category]?.[0] ?? `${cluster.subCategory || "待补充备注"}：先复活 3 条`;
}

function inferAlbumType(category: Category, subCategory: string): string {
  if (category === "内容创作") return "creative_theme";
  if (category === "AI 与效率") return "workflow_theme";
  if (category === "技能学习") return "learning_theme";
  if (category === "出行与探店") return subCategory.includes("探店") ? "shop_theme" : "travel_theme";
  if (category === "饮食与健康") return "recipe_health_theme";
  if (category === "暂存") return "needs_note";
  return "life_theme";
}

function buildSuggestedFirstAction(category: Category, subCategory: string): string {
  if (category === "内容创作") return "先打开推荐的第一条，写出 1 个自己的选题标题。";
  if (category === "AI 与效率") return "先复现第一条里的第一个工具步骤，保存截图或 prompt。";
  if (category === "出行与探店") return "先确认地点、时间、交通和预算，再放进一个候选日期。";
  if (category === "饮食与健康") return "先抄出食材或动作清单，标记今天能不能做。";
  if (category === "生活与家居") return "先选一个不超过 1 平米的小区域，列出移动、丢掉、购买三类动作。";
  if (category === "穿搭与消费") return "先提取风格关键词和核心单品，检查自己是否已有替代。";
  if (category === "情绪与关系") return "先摘出一句最触动的观点，再写一个自己的例子。";
  if (category === "读书与思考") return "先用自己的话改写 3 句，并写下 1 个追问。";
  return `先补一句为什么收藏这组「${subCategory}」，再重新生成行动卡。`;
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