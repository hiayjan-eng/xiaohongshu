import type { ActionCard, Category, RevivalRecommendation, SavedItem, SearchLog } from "@revival/shared-types";

export function getDailyRevivalRecommendations(params: {
  savedItems: SavedItem[];
  actionCards: ActionCard[];
  searchLogs?: SearchLog[];
  limit?: number;
  today?: Date;
}): RevivalRecommendation[] {
  const { savedItems, actionCards, searchLogs = [], limit = 3, today = new Date() } = params;
  const cardByItemId = new Map(actionCards.map((card) => [card.savedItemId, card]));
  const categoryCounts = getCategoryCounts(savedItems);
  const recentSearchCategories = inferRecentSearchCategories(searchLogs);
  const isWeekend = [0, 6].includes(today.getDay());

  return savedItems
    .filter((item) => item.status !== "completed" && item.status !== "snoozed")
    .map((item) => {
      const actionCard = cardByItemId.get(item.id);
      if (!actionCard) return undefined;

      const scoreParts = scoreRecommendation(item, actionCard, today, categoryCounts, recentSearchCategories, isWeekend);
      return {
        item,
        actionCard,
        score: scoreParts.score,
        reason: scoreParts.reasons.slice(0, 2).join("，")
      };
    })
    .filter((item): item is RevivalRecommendation => Boolean(item))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime();
    })
    .slice(0, limit);
}

function scoreRecommendation(
  item: SavedItem,
  actionCard: ActionCard,
  today: Date,
  categoryCounts: Record<Category, number>,
  recentSearchCategories: Set<Category>,
  isWeekend: boolean
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const daysSinceCreated = Math.floor((today.getTime() - new Date(item.createdAt).getTime()) / 86_400_000);

  if (daysSinceCreated <= 7) {
    score += 35;
    reasons.push("最近导入，还没有冷掉");
  } else if (daysSinceCreated <= 30) {
    score += 12;
  }

  if (item.status === "today") {
    score += 42;
    reasons.push("已经加入今日行动");
  } else if (item.status === "not_started") {
    score += 28;
    reasons.push("还没开始，适合复活");
  } else if (item.status === "in_progress") {
    score += 18;
    reasons.push("已经进行中，可以顺手推进");
  }

  const minutes = parseEstimatedMinutes(actionCard.estimatedTime);
  if (minutes <= 20) {
    score += 22;
    reasons.push("耗时短，今天容易完成");
  } else if (minutes <= 45) {
    score += 12;
  }

  const categoryPopularity = categoryCounts[item.category] ?? 0;
  score += Math.min(18, categoryPopularity * 4);
  if (categoryPopularity >= 2) reasons.push(`你最近收藏较多${item.category}`);

  if (isWeekend && ["旅行地点", "美食探店", "家居生活"].includes(item.category)) {
    score += 18;
    reasons.push("周末更适合执行");
  }

  if (recentSearchCategories.has(item.category)) {
    score += 14;
    reasons.push("和最近搜索方向相关");
  }

  if (reasons.length === 0) reasons.push("适合今天推进一步");
  return { score, reasons };
}

function getCategoryCounts(savedItems: SavedItem[]): Record<Category, number> {
  return savedItems.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {} as Record<Category, number>);
}

function inferRecentSearchCategories(searchLogs: SearchLog[]): Set<Category> {
  const categories = new Set<Category>();
  searchLogs.slice(-5).forEach((log) => {
    const query = log.query.toLocaleLowerCase();
    if (/(周末|旅行|地点|展览|路线|去哪|咖啡|餐厅|探店)/.test(query)) {
      categories.add("旅行地点");
      categories.add("美食探店");
    }
    if (/(剪辑|摄影|英语|学习|教程|入门|编程|设计)/.test(query)) categories.add("技能学习");
    if (/(菜|做饭|备餐|减脂|食材|晚餐)/.test(query)) categories.add("菜谱做饭");
    if (/(效率|sop|流程|自动化|模板|表格)/i.test(query)) categories.add("工作效率");
    if (/(选题|文案|封面|灵感|拍摄|账号)/.test(query)) categories.add("灵感素材");
    if (/(收纳|家居|清洁|改造|租房)/.test(query)) categories.add("家居生活");
  });
  return categories;
}

function parseEstimatedMinutes(value: string): number {
  const match = value.match(/\d+/);
  if (!match) return 45;
  const firstNumber = Number(match[0]);
  if (/小时/.test(value)) return firstNumber * 60;
  return firstNumber;
}
