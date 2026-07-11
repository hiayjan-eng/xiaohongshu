# AI Provider 与 Prompt 架构

当前状态：Phase 1/2 架构已准备，默认仍使用 Mock AI。没有 API Key 时，导入中心、旧收藏扫描、真实试用页、智能专辑和 E2E 都继续走本地 mock，不依赖网络。

## Provider 设计

AI 服务层位于 `packages/ai-service`，核心入口是 `AiProvider` 接口。当前支持：

- `MockAiProvider`：默认 provider，使用本地规则生成分类、行动卡、keywords、entities、searchableText 和智能专辑候选。
- `OpenAICompatibleProvider`：真实 AI 的可配置 provider，按 OpenAI-compatible chat completions 接口设计。没有 API Key、请求失败、超时、返回非 JSON、字段缺失时都会 fallback 到 mock。

Provider 方法包括：

- `classifyAndGenerateActionCard(input)`
- `generateSmartAlbums(input)`
- `regenerateActionCard(savedItemId, options)`
- `summarizeImportBatch(batch)`
- `generateSearchKeywords(input)`

## 环境变量

本地和 Vercel 都不要写死密钥。需要真实 AI 时再配置：

```bash
VITE_AI_PROVIDER=openai-compatible
VITE_AI_API_KEY=your_key_here
VITE_AI_BASE_URL=https://api.openai.com/v1
VITE_AI_MODEL=gpt-4.1-mini
VITE_AI_TIMEOUT_MS=30000
```

没有配置时使用：

```bash
VITE_AI_PROVIDER=mock
```

## Prompt 边界

统一 prompt 在 `packages/ai-service/src/prompts.ts`。原则是只基于用户主动导入的链接、标题、分享文本和备注生成私人使用的摘要、行动建议和搜索索引，不复制原帖全文，不重建小红书内容库。

输出必须是严格 JSON，并包含：`category`、`intent`、`summary`、`keywords`、`entities`、`searchableText`、`actionCard`。行动建议应能在 5-30 分钟内开始，不允许空泛口号。

## 当前 BLOCKED

真实 AI smoke test 需要用户提供 API Key，并在 Vercel Project Settings 中配置环境变量。没有凭证时不能宣称真实 AI 已经上线，只能使用 mock/fallback 路径。
