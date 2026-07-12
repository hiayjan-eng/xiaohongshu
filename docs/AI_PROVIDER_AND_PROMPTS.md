# AI Provider 与 Prompt 架构

当前状态：真实 AI 安全接入架构已准备好，默认仍使用 Mock AI。没有服务端 `AI_API_KEY` 时，导入中心、旧收藏扫描、真实试用页、智能专辑、重新生成行动卡和 E2E 都继续走 mock/fallback，不依赖真实模型。

## 调用边界

前端不能读取真实 AI Key，也不能使用任何会被 Vite 打进浏览器包的 AI 密钥变量。调用链是：

`Web UI -> @revival/ai-service AiHttpClient -> /api/ai -> server-side AIProvider -> real AI or mock fallback`

`/api/ai` 是 Vercel Function，只在服务端读取：

```bash
AI_PROVIDER
AI_API_KEY
AI_BASE_URL
AI_MODEL
AI_TIMEOUT_MS
```

## Provider 设计

AI 服务层位于 `packages/ai-service`，核心入口是 `AiProvider` 接口。当前支持：

- `MockAiProvider`：默认 provider，使用本地规则生成分类、行动卡、keywords、entities、searchableText 和智能专辑候选。
- `OpenAICompatibleProvider`：服务端真实 AI provider，按 OpenAI-compatible chat completions 接口设计。请求失败、超时、返回非 JSON 或字段缺失时，会归一化或 fallback 到 mock。
- `AiHttpClient`：前端安全 client，只调用 `/api/ai`，不接触真实 Key。

Provider 方法包括：

- `classifyAndGenerateActionCard(input)`
- `generateSmartAlbums(input)`
- `regenerateActionCard(savedItemId, options)`
- `summarizeImportBatch(batch)`
- `generateSearchKeywords(input)`

## Prompt 和 Schema

Prompt 位于 `packages/ai-service/src/prompts.ts`，按任务拆分：分类行动卡、智能专辑、重新生成行动卡、ImportBatch 摘要、搜索关键词。统一边界是只使用用户主动导入或确认导入的 `sourceUrl`、`title`、`rawShareText`、`visibleText`、`userNote`、已有摘要和索引字段；不复制原帖全文，不处理图片/视频/评论，不重建小红书内容库。

Schema 归一化位于 `packages/ai-service/src/schemas.ts`。真实模型可以返回 markdown 包裹 JSON 或缺字段，系统会尝试提取 JSON、修复字段、限制数组长度、规范 category 和行动卡字段。修不好就 fallback 到 mock。

## /api/ai 任务

`/api/ai` 只接受 POST，请求体形如：

```json
{
  "task": "classify_action_card",
  "payload": {}
}
```

支持任务：

- `classify_action_card`
- `generate_smart_albums`
- `regenerate_action_card`
- `summarize_import_batch`
- `generate_search_keywords`

如果 `AI_PROVIDER=openai-compatible` 但没有配置 `AI_API_KEY`，接口返回结构化错误：`AI_KEY_MISSING`。前端收到后会 fallback 到 mock。

## 当前 BLOCKED

真实 AI runtime smoke test 需要你在 Vercel Project Settings 中配置 `AI_API_KEY`。没有凭证时不能宣称真实 AI 已经在线，只能验证 mock/fallback、安全代理和 API shape。