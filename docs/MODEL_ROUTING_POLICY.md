# 模型路由策略

## 默认策略

- 产品运行时默认关闭外部模型，使用本地 Rule / Semantic / Hybrid 与 Mock fallback。
- 任何未来外部模型结果都是候选，不是 authority。
- `DEEPSEEK_API_KEY` 仅允许在未来服务端或独立开发 Worker 环境读取，永不写入前端、localStorage、测试截图或日志。

## 运行时路由

1. 本地规则先执行。
2. 仅在用户显式启用且低置信度或主动请求时，服务端可考虑外部候选。
3. 服务端先脱敏、限额、缓存并记录 token 成本。
4. 请求超时、限流、schema 无效或服务端错误时，确定性 fallback 到本地结果。
5. 外部输出经 JSON Schema、枚举、字段长度、引用和业务规则校验；失败不写入权威存储。

未来如接入 DeepSeek，使用 OpenAI-compatible `https://api.deepseek.com`；默认 `deepseek-v4-flash`，仅按任务提升到 `deepseek-v4-pro`。不采用已退役的 `deepseek-chat` 或 `deepseek-reasoner` 作为新默认值。[官方模型清单](https://api-docs.deepseek.com/api/list-models)

## 开发 Worker 路由

仅接受白名单 task type 和脱敏、大小受限的文件输入。输出必须是严格 JSON，先由本地 schema 校验，再由 Codex 审核。Worker 不读取仓库、不执行 shell、不直接写代码或数据、不参与 production build。

## 禁止路由

不向外部模型发送未脱敏真实收藏、用户身份、Key、迁移证据、Marker/Journal、生产日志原文或任何授权范围外数据。禁止用模型结果直接删除、合并、迁移、激活、发布或修改 Git。
