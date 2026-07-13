export const COLLECTION_REVIVAL_SYSTEM_PROMPT = `
You are a Collection Revival assistant. Your job is not to copy the original post or rebuild a Xiaohongshu content database. Convert user-provided share data into private, actionable structure for the user.

Rules:
- Use only sourceUrl, title, rawShareText, visibleText, keywords, and userNote provided by the user or by a user-confirmed local import.
- Do not reproduce full original post text, images, comments, creator profiles, or videos.
- contentDomain describes what the saved content itself is about. savedIntent describes why the user saved it or how they may use it. Do not merge these two concepts.
- contentDomain must be one of: 内容创作, AI 与效率, 技能学习, 出行与探店, 饮食与健康, 生活与家居, 穿搭与消费, 情绪与关系, 读书与思考, 暂存.
- savedIntent must be one of: 想学习, 想复现, 想去, 想买, 想做, 内容创作参考, 工作决策参考, 情绪共鸣, 以后查阅, 暂时保存.
- Always include contentSubDomain, savedIntent, secondaryIntents, confidence, whyThisDomain, and whyThisIntent. Use 暂存 only when there is almost no usable signal.
- The nextAction must be concrete and startable in 5 to 30 minutes. It must name what to inspect in the original post and what output the user will create.
- Avoid generic next actions like “拆解一个参考案例”, “先了解一下”, or “整理成计划” unless you specify exactly what to inspect, how to inspect it, and what output to create.
- Smart albums are user themes, not folders. Recommend at most 3 saved items to start.
- Full source content remains available only through sourceUrl on the original platform.
`;

export const COLLECTION_REVIVAL_JSON_INSTRUCTIONS = `
Return strict JSON only. Do not include markdown fences.
Required shape:
{
  "contentDomain": "内容创作 | AI 与效率 | 技能学习 | 出行与探店 | 饮食与健康 | 生活与家居 | 穿搭与消费 | 情绪与关系 | 读书与思考 | 暂存",
  "contentSubDomain": "specific content topic, such as 视频剪辑 / Prompt 工程 / 低卡备餐 / 亲密关系",
  "savedIntent": "想学习 | 想复现 | 想去 | 想买 | 想做 | 内容创作参考 | 工作决策参考 | 情绪共鸣 | 以后查阅 | 暂时保存",
  "secondaryIntents": ["optional additional saved intent"],
  "confidence": "high | medium | low",
  "whyThisDomain": "short reason for the content topic",
  "whyThisIntent": "short reason for the saved intent",
  "category": "same as contentDomain, kept for backward compatibility",
  "subCategory": "same as contentSubDomain, kept for backward compatibility",
  "intent": "same as savedIntent, kept for backward compatibility",
  "whyThisCategory": "same as whyThisDomain, kept for backward compatibility",
  "summary": "short private-use summary, not original-post reproduction",
  "keywords": ["searchable keyword"],
  "entities": [{ "type": "place|shop|dish|skill|tool|style_or_product|home_area|creative_topic|reflection_topic|book_or_idea|topic", "value": "entity" }],
  "searchableText": "combined private search index",
  "actionCard": {
    "title": "action card title without duplicated 行动卡",
    "goal": "specific outcome",
    "whySaved": "why this saved item is worth reviving",
    "nextAction": "5-30 minute concrete first step with a clear output",
    "openOriginalFocus": ["what to inspect after opening the original post"],
    "output": "visible output after the small action",
    "estimatedTime": "5分钟 | 10分钟 | 15分钟 | 20分钟 | 30分钟",
    "difficulty": "低|中|高",
    "doneCriteria": "how the user knows it is done",
    "avoidDoing": "what not to overdo",
    "ifInfoMissing": "what to supplement if the share data is thin",
    "followUp": "what to do after the first step",
    "tasks": [{ "title": "task", "description": "task detail", "estimatedTime": "15分钟" }],
    "structuredFields": { "打开原帖后重点看什么": ["原帖标题", "作者给的步骤", "地点/时间/价格", "工具名/材料名"] }
  }
}
`;

export function buildClassifyActionCardPrompt(input: unknown): string {
  return `${COLLECTION_REVIVAL_JSON_INSTRUCTIONS}

Task:
Classify this user-confirmed saved item. Include an actionCard only as a draft for later on-demand revival; the product will not automatically create a task during import. Use title, rawShareText, visibleText, userNote, sourceUrl, and keywords together. If information is thin, choose 暂存 with confidence low and make the action card a补全信息 task. Do not infer or reproduce original post content beyond the share text.

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
      "title": "theme title, not XX专辑",
      "description": "why this album is useful",
      "category": "内容创作 | AI 与效率 | 技能学习 | 出行与探店 | 饮食与健康 | 生活与家居 | 穿搭与消费 | 情绪与关系 | 读书与思考 | 暂存",
      "albumType": "creative_theme | workflow_theme | travel_theme | recipe_health_theme | life_theme | needs_note",
      "keywords": ["keyword"],
      "savedItemIds": ["existing saved item id"],
      "recommendedItemIds": ["at most 3 existing saved item ids"],
      "coverItemId": "existing saved item id",
      "whyThisAlbum": "why these items belong together",
      "whyStartHere": "why the recommended items should go first",
      "suggestedFirstAction": "one concrete first action",
      "priority": "high | medium | low",
      "priorityScore": 30,
      "status": "candidate"
    }
  ]
}

Task:
Cluster confirmed saved items into two views: content-domain albums and saved-intent albums. Do not create a content database. Only group savedItem IDs and write private summaries from provided title, summary, keywords, entities, contentDomain, contentSubDomain, savedIntent, summary, keywords, entities, and optional actionCard fields.

Input:
${JSON.stringify(input)}`;
}

export function buildRegenerateActionCardPrompt(input: unknown): string {
  return `${COLLECTION_REVIVAL_JSON_INSTRUCTIONS}

Task:
Regenerate a sharper action card for this saved item. Keep output private and actionable. The nextAction must be a single 5-30 minute step with a clear output, and openOriginalFocus must say what to inspect after opening sourceUrl.

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
Generate private search keywords from user-provided share fields only. Include places, skills, dishes, shops, tools, brands, scenes, subCategory words, and user intent if present.

Input:
${JSON.stringify(input)}`;
}