import type { ActionCard, Category, SavedItem, SearchResult } from "@revival/shared-types";

type SemanticRule = {
  triggers: string[];
  categories: Category[];
  reason: string;
};

const semanticRules: SemanticRule[] = [
  {
    triggers: ["周末", "去哪", "地方", "出游", "散步", "展览", "旅行", "路线", "附近"],
    categories: ["旅行地点", "美食探店"],
    reason: "语义匹配：适合出门、周末或地点类收藏"
  },
  {
    triggers: ["学", "练", "入门", "教程", "技能", "上手", "提升"],
    categories: ["技能学习", "工作效率"],
    reason: "语义匹配：学习或效率提升类收藏"
  },
  {
    triggers: ["吃", "店", "餐", "咖啡", "甜品", "约饭", "人均"],
    categories: ["美食探店", "菜谱做饭"],
    reason: "语义匹配：吃饭、探店或做饭相关收藏"
  },
  {
    triggers: ["做饭", "备餐", "菜", "食材", "晚餐", "减脂"],
    categories: ["菜谱做饭"],
    reason: "语义匹配：菜谱和备餐类收藏"
  },
  {
    triggers: ["选题", "写", "文案", "封面", "拍摄", "灵感", "账号"],
    categories: ["灵感素材"],
    reason: "语义匹配：创作灵感和内容选题"
  },
  {
    triggers: ["收纳", "家", "整理", "清洁", "改造", "租房"],
    categories: ["家居生活"],
    reason: "语义匹配：家居整理或生活改造"
  }
];

export function searchSavedItems(query: string, savedItems: SavedItem[], actionCards: ActionCard[]): SearchResult[] {
  const cleanQuery = normalize(query);
  if (!cleanQuery) return [];

  const cardByItemId = new Map(actionCards.map((card) => [card.savedItemId, card]));
  const queryTerms = buildQueryTerms(cleanQuery);

  return savedItems
    .map((item) => scoreItem(item, cardByItemId.get(item.id), cleanQuery, queryTerms))
    .filter((result): result is SearchResult => result !== undefined && result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime();
    });
}

export async function semanticSearch(_query: string): Promise<SearchResult[]> {
  // Reserved for embeddings + vector database. The first MVP keeps this shape
  // so the UI and service boundary will not change when a real provider is added.
  return [];
}

function scoreItem(item: SavedItem, actionCard: ActionCard | undefined, cleanQuery: string, queryTerms: string[]): SearchResult | undefined {
  let score = 0;
  const reasons = new Set<string>();
  const cardFields = actionCard ? flattenFields(actionCard.fields) : "";
  const taskText = actionCard ? actionCard.tasks.map((task) => `${task.title} ${task.description}`).join(" ") : "";

  queryTerms.forEach((term) => {
    if (matches(item.title, term)) {
      score += 80;
      reasons.add(`命中标题：${displayTerm(term)}`);
    }

    const keywordHit = item.keywords.find((keyword) => matches(keyword, term) || term.includes(normalize(keyword)));
    if (keywordHit) {
      score += 70;
      reasons.add(`命中关键词：${keywordHit}`);
    }

    const entityHit = item.entities.find((entity) => matches(entity.value, term) || term.includes(normalize(entity.value)));
    if (entityHit) {
      score += 65;
      reasons.add(`命中${entityLabel(entityHit.type)}：${entityHit.value}`);
    }

    if (matches(item.category, term) || matches(item.intent, term)) {
      score += 42;
      reasons.add(`命中分类：${item.category}`);
    }

    if (matches(item.userNote, term)) {
      score += 36;
      reasons.add(`命中备注：${displayTerm(term)}`);
    }

    if (matches(item.summary, term) || matches(item.rawShareText, term)) {
      score += 30;
      reasons.add(`命中分享信息：${displayTerm(term)}`);
    }

    if (actionCard && (matches(actionCard.title, term) || matches(actionCard.goal, term) || matches(actionCard.nextAction, term) || matches(cardFields, term))) {
      score += 28;
      reasons.add(`命中行动卡：${actionCard.title}`);
    }

    if (matches(taskText, term)) {
      score += 20;
      reasons.add(`命中任务：${displayTerm(term)}`);
    }

    if (matches(item.searchableText, term)) {
      score += 12;
      if (reasons.size < 3) reasons.add(`命中索引：${displayTerm(term)}`);
    }
  });

  const semanticReason = getSemanticReason(cleanQuery, item.category);
  if (semanticReason) {
    score += 38;
    reasons.add(semanticReason);
  }

  if (!score) return undefined;

  return {
    item,
    actionCard,
    score,
    matchReasons: Array.from(reasons).slice(0, 5)
  };
}

function buildQueryTerms(cleanQuery: string): string[] {
  const terms = new Set<string>([cleanQuery]);
  cleanQuery
    .split(/[\s,，。.!！?？、|/\\:：;；《》「」“”()[\]【】]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)
    .forEach((part) => terms.add(part));

  semanticRules.flatMap((rule) => rule.triggers).forEach((trigger) => {
    if (cleanQuery.includes(normalize(trigger))) terms.add(normalize(trigger));
  });

  return Array.from(terms).slice(0, 12);
}

function getSemanticReason(cleanQuery: string, category: Category): string | undefined {
  const rule = semanticRules.find((item) => {
    const hasTrigger = item.triggers.some((trigger) => cleanQuery.includes(normalize(trigger)));
    return hasTrigger && item.categories.includes(category);
  });

  return rule?.reason;
}

function matches(value: string | undefined, term: string): boolean {
  if (!value || !term) return false;
  const normalizedValue = normalize(value);
  return normalizedValue.includes(term) || (term.length >= 2 && term.includes(normalizedValue) && normalizedValue.length <= 12);
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function flattenFields(fields: ActionCard["fields"]): string {
  return Object.entries(fields)
    .flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : value])
    .join(" ");
}

function displayTerm(term: string): string {
  return term.length > 18 ? `${term.slice(0, 18)}...` : term;
}

function entityLabel(type: string): string {
  const labels: Record<string, string> = {
    place: "地点",
    shop: "店名",
    dish: "菜名",
    skill: "技能",
    tool: "工具",
    style: "风格",
    home: "家居主题",
    creative: "灵感"
  };
  return labels[type] ?? "实体";
}

