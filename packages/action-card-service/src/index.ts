import type { ActionCard, Category, Plan, PlanType, SavedItem, Task } from "@revival/shared-types";

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
  旅行地点: "travel",
  美食探店: "travel",
  菜谱做饭: "recipe",
  穿搭变美: "life",
  家居生活: "life",
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
