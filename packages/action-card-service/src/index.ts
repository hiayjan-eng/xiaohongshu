import type { ActionCard, Category, Plan, PlanType, SavedItem, SmartAlbum, Task } from "@revival/shared-types";

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  learning: "学习计划",
  travel: "旅行计划",
  recipe: "菜谱计划",
  workflow: "工作流计划",
  life: "生活计划",
  creative: "创作计划",
  mixed: "混合计划"
};

const categoryPlanType: Record<Category, PlanType> = {
  技能学习: "learning",
  内容创作: "creative",
  小红书运营: "creative",
  AI工具: "workflow",
  职场学习: "learning",
  旅行地点: "travel",
  美食探店: "travel",
  菜谱做饭: "recipe",
  穿搭变美: "life",
  购物参考: "life",
  家居生活: "life",
  生活方式: "life",
  情绪成长: "life",
  亲密关系: "life",
  健身运动: "life",
  读书学习: "learning",
  工作效率: "workflow",
  灵感素材: "creative",
  其他: "mixed"
};

export function getPlanTypeForCategory(category: Category): PlanType {
  return categoryPlanType[category];
}

export function findActionCardBySavedItem(actionCards: ActionCard[], savedItemId: string): ActionCard | undefined {
  return actionCards.find((card) => card.savedItemId === savedItemId);
}

export function createPlansFromActionCards(userId: string, savedItems: SavedItem[], actionCards: ActionCard[], now = new Date()): Plan[] {
  const activeItemIds = new Set(
    savedItems
      .filter((item) => item.status !== "completed" && item.status !== "snoozed")
      .map((item) => item.id)
  );

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
  const label = PLAN_TYPE_LABELS[type];
  if (type === "travel") return `把 ${count} 张地点或探店卡整理成可执行的短途清单。`;
  if (type === "recipe") return `从 ${count} 张菜谱卡里挑出最近能做的几道菜。`;
  if (type === "workflow") return `把 ${count} 张效率卡压缩成可复用 SOP。`;
  if (type === "creative") return `把 ${count} 张灵感卡转成选题和创作动作。`;
  return `把 ${count} 张${label}行动卡排进一个轻量执行节奏。`;
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

const albumTitleHints: Partial<Record<Category, string[]>> = {
  技能学习: ["学习清单", "入门练习", "想学的技能"],
  旅行地点: ["想去的城市和路线", "周末去哪", "旅行灵感"],
  美食探店: ["想去探店", "周末吃什么", "咖啡和餐厅清单"],
  菜谱做饭: ["低卡晚餐和备餐", "想做的菜", "厨房练习"],
  穿搭变美: ["穿搭变美灵感", "今日小改变", "风格参考"],
  家居生活: ["租房改造计划", "家居整理", "周末生活改造"],
  工作效率: ["效率工具和 SOP", "工作流优化", "省时间清单"],
  灵感素材: ["小红书图文创作灵感", "选题和封面参考", "内容创作素材"],
  其他: ["待整理收藏", "稍后再判断", "杂项灵感"]
};

export function generateSmartAlbums(savedItems: SavedItem[], now = new Date()): SmartAlbum[] {
  const activeItems = dedupeItems(savedItems).filter((item) => item.status !== "completed" && item.status !== "snoozed");
  const byCategory = activeItems.reduce<Record<Category, SavedItem[]>>((groups, item) => {
    groups[item.category] = groups[item.category] ?? [];
    groups[item.category].push(item);
    return groups;
  }, {} as Record<Category, SavedItem[]>);

  return Object.entries(byCategory)
    .map(([category, items]) => buildSmartAlbum(category as Category, items, now))
    .filter((album): album is SmartAlbum => Boolean(album))
    .sort((a, b) => b.priority - a.priority || b.savedItemIds.length - a.savedItemIds.length)
    .slice(0, 8);
}

function buildSmartAlbum(category: Category, items: SavedItem[], now: Date): SmartAlbum | undefined {
  if (items.length === 0) return undefined;

  const sortedItems = [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const keywords = pickAlbumKeywords(sortedItems);
  const title = pickAlbumTitle(category, keywords);
  const createdAt = now.toISOString();

  return {
    id: `album_${slugify(category)}_${keywords[0] ? slugify(keywords[0]) : "general"}`,
    title,
    description: `从 ${sortedItems.length} 条${category}收藏里整理出的智能专辑。先复活其中 3 条，不需要一次处理完所有旧收藏。`,
    category,
    keywords,
    savedItemIds: sortedItems.map((item) => item.id),
    coverItemId: sortedItems[0]?.id,
    priority: sortedItems.length * 10 + keywords.length,
    status: "candidate",
    createdAt,
    updatedAt: createdAt
  };
}

function pickAlbumKeywords(items: SavedItem[]): string[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    [...item.keywords, ...item.entities.map((entity) => entity.value)]
      .map((keyword) => keyword.trim())
      .filter((keyword) => keyword.length >= 2 && keyword.length <= 16)
      .forEach((keyword) => counts.set(keyword, (counts.get(keyword) ?? 0) + 1));
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .map(([keyword]) => keyword)
    .slice(0, 6);
}

function pickAlbumTitle(category: Category, keywords: string[]): string {
  const primary = keywords[0];
  if (category === "旅行地点" && primary) return `${primary}周末去哪`;
  if (category === "美食探店" && primary) return `${primary}探店清单`;
  if (category === "菜谱做饭" && primary) return `${primary}和备餐`;
  if (category === "技能学习" && primary) return `${primary}学习清单`;
  if (category === "灵感素材" && primary) return `${primary}创作灵感`;
  return albumTitleHints[category]?.[0] ?? `${category}专辑`;
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

function slugify(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "").slice(0, 32).toLowerCase() || "untitled";
}