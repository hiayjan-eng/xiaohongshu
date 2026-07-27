# DeepSeek 分工与路由审计

## 范围与结论

本文件只记录设计审计；未安装 SDK、未创建或读取 `DEEPSEEK_API_KEY`、未调用 API，且没有运行时接入。

推荐顺序：**若要实施，先做开发辅助 Worker；暂不做产品运行时 Provider。** Worker 的输入可以被严格限制为脱敏、结构化、可校验的机械任务。产品 Provider 当前不具备安全上线前提：仓库内没有服务端 `/api/ai` 实现，浏览器 `AiHttpClient` 会向该路径发送任务和 fallback 数据；同时 `OpenAICompatibleProvider` 具备直接 HTTP 调用和 `AI_API_KEY` 配置能力，不应被接入浏览器 bundle。

## 当前 AI 架构

`apps/web/App.tsx` 创建 `createAiClient`，得到 `AiHttpClient`；它调用相对路径 `/api/ai` 并在失败时使用本地 Mock fallback。当前 `apps/web` 内没有该服务端路由，因此产品实际保持 mock/local-rules fallback，未发现当前 UI 直接向 DeepSeek 或其他模型供应商发起调用。

`packages/ai-service` 已有三层能力：

- `MockAiProvider`：本地规则与确定性 fallback。
- `AiHttpClient`：客户端到预期 server proxy 的任务接口，并对结果做 normalization。
- `OpenAICompatibleProvider`：可配置 HTTP provider，读取通用 `AI_PROVIDER`、`AI_API_KEY`、`AI_BASE_URL`、`AI_MODEL`；这是应当只在未来服务端使用的能力。

`packages/classification-service` 有 Rule、Semantic-local-prototype 和 Hybrid 分类器，属于本地确定性/可解释路径。`packages/action-card-service` 从已确认的分类结果生成计划和行动卡。`packages/ai-service/schemas.ts` 已定义有限的 AI task、响应 meta 与 normalization；它可作为未来 JSON Schema 校验的起点，但当前不构成完整的服务器安全边界。

## 官方 API 基线

官方文档目前列出 OpenAI-compatible base URL `https://api.deepseek.com`，并支持 `deepseek-v4-flash` 与 `deepseek-v4-pro`；旧 `deepseek-chat`、`deepseek-reasoner` 已不应作为新实现默认模型。[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/?article_id=article_1779470751466_8) [变更日志](https://api-docs.deepseek.com/updates/)

默认候选应为 `deepseek-v4-flash`；只有结构复杂、审核仍低成本的离线候选任务才考虑 `deepseek-v4-pro`。官方 JSON mode 仍只保证 JSON 形状，产品侧必须继续做本地 schema、枚举、长度、引用完整性和业务规则校验。[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)

## 两条路线必须分离

| 路线 | 目的 | 接入位置 | Key 与数据边界 | 当前建议 |
| --- | --- | --- | --- | --- |
| 开发辅助 Worker | 日志压缩、脱敏 JSON 转换、fixture/文档草稿 | 独立 CLI，不进入产品 build | 仅 `DEEPSEEK_API_KEY`，白名单输入文件、大小上限、默认不写文件 | 可作为最小实现候选 |
| 产品运行时 Provider | 分类、摘要、行动卡、专辑候选 | 仅未来服务端代理 | Key 永不进浏览器；用户显式启用；最小脱敏请求 | 暂不实施 |

两者不得共享一个无边界 endpoint、密钥配置或日志管道。

## Codex / DeepSeek 分工

| Codex 永久负责 | DeepSeek 可候选委派 |
| --- | --- |
| 产品目标、数据模型、存储、迁移、激活、隐私、安全、Git、发布、根因分析、最终代码审查与验收 | 字段提取、关键词/实体/主题候选、意图候选、文本规范化、短摘要初稿、专辑命名候选、重复解释候选、脱敏测试日志分类、fixture 文本、changelog 草稿、已确定 schema 下的 JSON 转换 |

黑名单：最终分类或删除/合并决定、迁移/Activation/Recovery、安全判断、生产故障处置、真实收藏批量上传、Git/shell/部署、大范围补丁、最终审核、Key 管理。

## Worker 最小安全契约

建议形态为 `scripts/deepseek-worker/` 与 `pnpm deepseek:task --type <whitelisted-task> --input <file>`，但本轮不实现。最低要求：task type 枚举；输入字节和记录数上限；默认只读取明确文件；脱敏器；无 shell/tool 权限；严格 JSON 输出；本地 schema 与规则校验；超时和有限重试；无 Key 时安全退出；日志不含 Key、原文或完整敏感输入；默认不写文件；Codex 显式审核后才能采用。

产品 Provider 若未来考虑，必须补齐服务端代理、用户 opt-in、rule-first/低置信度触发、请求脱敏、缓存生命周期、token 成本记录、限流、超时和确定性 fallback。当前 `/api/ai` 缺失意味着不能把任一供应商 Key 或调用逻辑放入前端来“补齐”它。

## Token 节省的保守评估

可能节省：大段测试日志压缩、重复 JSON 重排、字段候选、fixture 和文档草稿。前提是输入已脱敏、输出可由 schema 自动拒绝错误，并且人工抽检成本低。

基本不能节省：Codex 对仓库上下文的理解、架构与安全推理、Playwright/pnpm 的实际执行及 3k/10k 等待、Git/Vercel 操作、最终审查。对短小或高风险任务，输入整理加复核成本通常高于 Codex 直接完成成本。

## 最小实施顺序

1. 仅设计并测试 Worker 输入/输出 schema、脱敏与 no-key 退出，不接 API。
2. 在明确授权后，实现仅含一个低风险 task type 的 Worker，并测量端到端复核成本。
3. 只有先具备服务端代理、隐私/成本控制和 opt-in 后，才评估产品 Provider。

当前建议：**可以规划开发辅助 Worker；不建议现在实施产品 Provider。**
