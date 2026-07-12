# 真实 AI Provider 配置说明

这份文档只说明如何配置真实 AI。当前产品仍然可以在没有 Key 的情况下完整运行，因为默认使用 mock/fallback。

## 安全规则

真实 AI Key 只能放在服务端环境变量中。不要把 Key 写进代码、README、截图、测试日志或任何 `.env` 提交文件。不要使用会暴露给 Vite 前端的变量名来保存 AI Key。

前端只调用：

```text
/api/ai
```

服务端读取：

```bash
AI_PROVIDER=mock
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_TIMEOUT_MS=30000
```

## 本地默认 mock

不创建 `.env.local` 也可以开发和测试。默认是：

```bash
AI_PROVIDER=mock
```

这时导入、旧收藏扫描、智能专辑、真实试用页和重新生成行动卡都会继续使用本地规则，不会产生模型费用。

## 本地真实 AI 实验

如果你要在本机实验真实 AI，请复制 `.env.example` 为 `.env.local`，只填本机文件，不提交：

```bash
AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_TIMEOUT_MS=30000
```

Vite dev server 本身不一定会承载 Vercel Function；本地真实函数验证建议用 `vercel dev` 或部署到 Vercel 后在 `/qa` 点 `Test /api/ai`。

## Vercel Production 配置

打开 Vercel 项目：Project Settings -> Environment Variables，添加：

```bash
AI_PROVIDER=openai-compatible
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=<model name>
AI_TIMEOUT_MS=30000
```

保存后重新部署 Production。部署完成后打开：

- `/settings`：查看 AI provider、model、fallback 状态。
- `/qa`：点击 `Test /api/ai`，检查返回状态。
- `/import`：手动导入一条真实收藏，确认行动卡正常生成。
- `/albums`：点击重新生成专辑，确认不会白屏。

## Fallback 行为

以下情况会 fallback 到 mock：

- 没有配置 Key。
- `/api/ai` 不可用。
- 模型请求超时。
- 模型返回非 JSON 或字段不完整。
- payload 过大或批量过多。

fallback 是预期的安全行为，不代表产品坏了。只有在配置 Key 后，才需要继续检查真实 AI 输出质量。

## 成本提醒

旧收藏扫描和 ImportBatch 可能包含多条记录。当前服务端会限制 payload 大小，智能专辑会限制传给 AI 的记录数量。朋友测试阶段建议先用 3-5 条内容验证，再扩大到 20 条。

## BLOCKED_REAL_AI_RUNTIME_TEST

当前仓库不会包含真实 Key。如果没有你在 Vercel 配置 `AI_API_KEY`，真实 AI runtime 测试必须标记为：

```text
BLOCKED_REAL_AI_RUNTIME_TEST: waiting for user to configure AI_API_KEY in Vercel.
```