import type { ActionCard, Category, SavedItem, SearchResult, SmartAlbum } from "@revival/shared-types";

type SemanticRule = {
  triggers: string[];
  categories: Category[];
  reason: string;
};

const semanticRules: SemanticRule[] = [
  { triggers: ["周末", "去哪", "地方", "出游", "散步", "展览", "旅行", "路线", "附近", "探店", "咖啡"], categories: ["出行与探店"], reason: "语义匹配：适合出门、周末或地点类收藏" },
  { triggers: ["ai", "工具", "prompt", "提示词", "效率", "流程", "自动化", "sop", "模板"], categories: ["AI 与效率"], reason: "语义匹配：AI 工具、效率流程或可复用 SOP" },
  { triggers: ["学", "练", "入门", "教程", "技能", "上手", "提升", "剪辑", "摄影", "英语"], categories: ["技能学习"], reason: "语义匹配：学习或技能练习类收藏" },
  { triggers: ["吃", "做饭", "备餐", "菜", "食材", "晚餐", "减脂", "健身", "运动"], categories: ["饮食与健康"], reason: "语义匹配：饮食、备餐或健康练习" },
  { triggers: ["选题", "写", "文案", "封面", "拍摄", "灵感", "账号", "小红书"], categories: ["内容创作"], reason: "语义匹配：创作灵感、账号运营或内容选题" },
  { triggers: ["收纳", "家", "整理", "清洁", "改造", "租房", "桌面", "衣柜"], categories: ["生活与家居"], reason: "语义匹配：家居整理或生活改造" },
  { triggers: ["穿搭", "购物", "种草", "平替", "护肤", "单品", "品牌"], categories: ["穿搭与消费"], reason: "语义匹配：穿搭、变美或消费参考" },
  { triggers: ["情绪", "关系", "表达", "需求", "边界", "复盘", "手帐"], categories: ["情绪与关系"], reason: "语义匹配：情绪、关系或自我观察" },
  { triggers: ["读书", "书单", "观点", "笔记", "阅读", "摘抄"], categories: ["读书与思考"], reason: "语义匹配：阅读、观点或思考笔记" }
];

export function searchSavedItems(query: string, savedItems: SavedItem[], actionCards: ActionCard[], smartAlbums: SmartAlbum[] = []): SearchResult[] {
  const cleanQuery = normalize(query);
  if (!cleanQuery) return [];
  const cardByItemId = new Map(actionCards.map((card) => [card.savedItemId, card]));
  const albumsByItemId = groupAlbumsByItemId(smartAlbums);
  const queryTerms = buildQueryTerms(cleanQuery);
  return savedItems
    .map((item) => scoreItem(item, cardByItemId.get(item.id), albumsByItemId.get(item.id) ?? [], cleanQuery, queryTerms))
    .filter((result): result is SearchResult => result !== undefined && result.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime()));
}

export async function semanticSearch(_query: string): Promise<SearchResult[]> {
  return [];
}

function scoreItem(item: SavedItem, actionCard: ActionCard | undefined, albums: SmartAlbum[], cleanQuery: string, queryTerms: string[]): SearchResult | undefined {
  let score = 0;
  const reasons = new Set<string>();
  const cardFields = actionCard ? flattenFields(actionCard.fields) : "";
  const taskText = actionCard ? actionCard.tasks.map((task) => `${task.title} ${task.description}`).join(" ") : "";
  const cardText = actionCard ? [actionCard.title, actionCard.goal, actionCard.whySaved, actionCard.nextAction, actionCard.openOriginalFocus.join(" "), actionCard.output, actionCard.doneCriteria, actionCard.avoidDoing, actionCard.ifInfoMissing, actionCard.followUp, cardFields, taskText].join(" ") : "";
  const extendedItem = item as SavedItem & {
    displayTitle?: string;
    cleanedTitle?: string;
    rawTitle?: string;
    userEditedTitle?: string;
    visibleText?: string;
  };
  const titleText = [
    item.title,
    extendedItem.displayTitle,
    extendedItem.cleanedTitle,
    extendedItem.rawTitle,
    extendedItem.userEditedTitle
  ].filter(Boolean).join(" ");
  const itemText = [
    titleText,
    item.rawShareText,
    item.userNote,
    extendedItem.visibleText,
    item.summary,
    item.searchableText,
    item.contentDomain,
    item.contentSubDomain,
    item.savedIntent,
    item.secondaryIntents.join(" "),
    item.whyThisDomain,
    item.whyThisIntent
  ].filter(Boolean).join(" ");
  const albumText = albums.map((album) => [
    album.title,
    album.description,
    album.contentDomain,
    album.contentSubDomain,
    album.savedIntent,
    album.keywords.join(" "),
    album.whyThisAlbum,
    album.suggestedFirstAction
  ].filter(Boolean).join(" ")).join(" ");

  queryTerms.forEach((term) => {
    if (matches(titleText, term)) { score += 85; reasons.add(`命中标题：${displayTerm(term)}`); }
    const keywordHit = item.keywords.find((keyword) => matches(keyword, term) || term.includes(normalize(keyword)));
    if (keywordHit) { score += 70; reasons.add(`命中关键词：${keywordHit}`); }
    const entityHit = item.entities.find((entity) => matches(entity.value, term) || term.includes(normalize(entity.value)));
    if (entityHit) { score += 65; reasons.add(`命中${entityLabel(entityHit.type)}：${entityHit.value}`); }
    if (matches(item.category, term) || matches(item.subCategory, term) || matches(item.intent, term) || matches(item.whyThisCategory, term) || matches(item.contentDomain, term) || matches(item.contentSubDomain, term) || matches(item.savedIntent, term)) { score += 46; reasons.add(`命中分类：${item.contentDomain} / ${item.contentSubDomain}`); }
    if (matches(item.userNote, term)) { score += 36; reasons.add(`命中备注：${displayTerm(term)}`); }
    if (matches(item.summary, term) || matches(item.rawShareText, term) || matches(extendedItem.visibleText, term)) { score += 30; reasons.add(`命中分享信息：${displayTerm(term)}`); }
    if (matches(cardText, term)) { score += 28; reasons.add(`命中行动卡：${actionCard?.title ?? displayTerm(term)}`); }
    if (matches(albumText, term)) {
      const album = albums.find((entry) => matches(entry.title, term) || matches(entry.keywords.join(" "), term));
      score += 34;
      reasons.add(`命中专辑：${album?.title ?? displayTerm(term)}`);
    }
    if (matches(itemText, term)) { score += 12; if (reasons.size < 3) reasons.add(`命中索引：${displayTerm(term)}`); }
  });

  const semanticReason = getSemanticReason(cleanQuery, item.category);
  if (semanticReason) { score += 38; reasons.add(semanticReason); }
  if (!score) return undefined;
  return { item, actionCard, score, matchReasons: Array.from(reasons).slice(0, 5) };
}

function groupAlbumsByItemId(albums: SmartAlbum[]): Map<string, SmartAlbum[]> {
  const map = new Map<string, SmartAlbum[]>();
  albums.forEach((album) => {
    [...album.savedItemIds, ...(album.suggestedItemIds ?? [])].forEach((itemId) => {
      map.set(itemId, [...(map.get(itemId) ?? []), album]);
    });
  });
  return map;
}

function buildQueryTerms(cleanQuery: string): string[] {
  const terms = new Set<string>([cleanQuery]);
  cleanQuery.split(/[\s,，。.!！?？、|/\\:：;；《》「」“”()[\]【】]+/).map((part) => part.trim()).filter((part) => part.length >= 2).forEach((part) => terms.add(part));
  semanticRules.flatMap((rule) => rule.triggers).forEach((trigger) => { if (cleanQuery.includes(normalize(trigger))) terms.add(normalize(trigger)); });
  return Array.from(terms).slice(0, 12);
}

function getSemanticReason(cleanQuery: string, category: Category): string | undefined {
  const rule = semanticRules.find((item) => item.triggers.some((trigger) => cleanQuery.includes(normalize(trigger))) && item.categories.includes(category));
  return rule?.reason;
}

function matches(value: string | undefined, term: string): boolean {
  if (!value || !term) return false;
  const normalizedValue = normalize(value);
  return normalizedValue.includes(term) || (term.length >= 2 && term.includes(normalizedValue) && normalizedValue.length <= 12);
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
}

function flattenFields(fields: ActionCard["fields"]): string {
  return Object.entries(fields).flatMap(([key, value]) => [key, Array.isArray(value) ? value.join(" ") : value]).join(" ");
}

function displayTerm(term: string): string {
  return term.length > 18 ? `${term.slice(0, 18)}...` : term;
}

function entityLabel(type: string): string {
  const labels: Record<string, string> = { place: "地点", shop: "店名", dish: "菜名", skill: "技能", tool: "工具", style: "风格", home: "家居主题", creative: "灵感", creative_topic: "创作主题", home_area: "家居主题", style_or_product: "风格/单品", reflection_topic: "观察主题", book_or_idea: "观点" };
  return labels[type] ?? "实体";
}
