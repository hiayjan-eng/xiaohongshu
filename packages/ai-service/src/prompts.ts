export const COLLECTION_REVIVAL_SYSTEM_PROMPT = `
You are a Collection Revival assistant. Your job is not to copy the original post or rebuild a Xiaohongshu content database. Convert user-provided share data into private, actionable structure for the user.

Rules:
- Use only sourceUrl, title, rawShareText, visibleText, and userNote provided by the user or by a user-confirmed local import.
- Do not reproduce full original post text, images, comments, creator profiles, or videos.
- Generate category, confidence, intent, summary, keywords, entities, searchableText, nextAction, estimatedTime, difficulty, tasks, and structuredFields.
- The nextAction must be concrete and startable in 5 to 30 minutes. It should name what to look for in the original post and what the user will produce.
- Action cards should be specific and practical. Avoid generic lines like “拆解一个参考案例”, “先了解一下”, or “整理成计划” unless you also specify what to inspect, how to inspect it, and what output to create.
- Smart albums should be understandable user themes, not overly fragmented clusters.
- Every smart album should explain why it is worth opening first.
- Full source content remains available only through sourceUrl on the original platform.
`;

export const COLLECTION_REVIVAL_JSON_INSTRUCTIONS = `
Return strict JSON only. Do not include markdown fences.
Required shape:
{
  "category": "技能学习 | 内容创作 | 小红书运营 | AI工具 | 职场学习 | 旅行地点 | 美食探店 | 菜谱做饭 | 穿搭变美 | 购物参考 | 家居生活 | 生活方式 | 情绪成长 | 亲密关系 | 健身运动 | 读书学习 | 工作效率 | 灵感素材 | 其他",
  "confidence": "high | medium | low",
  "intent": "why the user likely saved this",
  "summary": "short private-use summary",
  "keywords": ["searchable keyword"],
  "entities": [{ "type": "place|shop|dish|skill|tool|style|home|creative|career|product|life|emotion|relationship|fitness|book|topic", "value": "entity" }],
  "searchableText": "combined private search index",
  "actionCard": {
    "title": "action card title",
    "goal": "specific outcome",
    "nextAction": "5-30 minute concrete first step",
    "estimatedTime": "20分钟",
    "difficulty": "低|中|高",
    "tasks": [{ "title": "task", "description": "task detail", "estimatedTime": "15分钟" }],
    "structuredFields": { "打开原帖后重点看什么": ["原帖标题", "作者给的步骤", "地点/时间/价格", "工具名/材料名"] }
  }
}
`;
export function buildClassifyActionCardPrompt(input: unknown): string {
  return `${COLLECTION_REVIVAL_JSON_INSTRUCTIONS}

Task:
Classify this user-confirmed saved item and generate one private action card. Use title, rawShareText, visibleText, userNote, sourceUrl, and keywords together. Do not classify as 其他 unless there is truly no usable signal; when information is thin, choose the closest category and set confidence to low. Use only the fields provided below. Do not infer or reproduce original post content beyond the share text.

Input:
${JSON.stringify(input)}`;
}

export function buildSmartAlbumsPrompt(input: unknown): string {
  return `
Return strict JSON only. Do not include markdown fences.
Required shape:
{
  "albums": [
    {
      "title": "album title",
      "description": "why this album is useful and what to revive first",
      "category": "one allowed category",
      "keywords": ["keyword"],
      "savedItemIds": ["existing saved item id"],
      "coverItemId": "existing saved item id",
      "priority": 80,
      "status": "candidate"
    }
  ]
}

Task:
Cluster the confirmed saved items into a small number of smart albums. Each album must be useful, private, and action-oriented. Do not create a content database. Only group savedItem IDs and write private summaries from the provided title, summary, keywords, entities, and category.

Input:
${JSON.stringify(input)}`;
}

export function buildRegenerateActionCardPrompt(input: unknown): string {
  return `${COLLECTION_REVIVAL_JSON_INSTRUCTIONS}

Task:
Regenerate a sharper action card for this saved item. Keep the output private and actionable. The nextAction must be a single 5-30 minute step with a clear output, and structuredFields must include “打开原帖后重点看什么”.

Input:
${JSON.stringify(input)}`;
}

export function buildImportBatchSummaryPrompt(input: unknown): string {
  return `
Return strict JSON only. Do not include markdown fences.
Required shape:
{
  "title": "short batch title",
  "summary": "private summary of this import batch",
  "recommendedNextStep": "what the user should do next",
  "fallbackUsed": false
}

Task:
Summarize the import batch status for the user. Focus on what happened and the next safe action. Do not mention implementation details or copy original post content.

Input:
${JSON.stringify(input)}`;
}

export function buildSearchKeywordsPrompt(input: unknown): string {
  return `
Return strict JSON only. Do not include markdown fences.
Required shape:
{
  "keywords": ["short private search keyword"]
}

Task:
Generate private search keywords from user-provided share fields only. Include places, skills, dishes, shops, tools, brands, and scenes if they are present.

Input:
${JSON.stringify(input)}`;
}