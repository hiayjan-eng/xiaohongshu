# 平台架构规格

## 1. 当前仓库结构

```text
apps/
  web/        React + Vite Web 工作台
  extension/ Chrome / Edge Manifest V3 扩展 Beta
  mobile/    分享入口 adapter 预留，不是完整 App
api/
  ai.ts      Vercel serverless AI proxy
packages/
  shared-types
  ai-service
  classification-service
  import-service
  action-card-service
  search-service
  recommendation-service
  database
  storage-service
```

当前架构的优势是共享包已经比较清楚：导入、分类、AI、搜索和数据规范化都不完全绑死在 UI 里。主要风险是 `apps/web/src/App.tsx` 仍承担大量页面和状态逻辑，后续扩展会使文件继续变重。

## 2. apps/web

当前状态：

- Vite SPA，Vercel `vercel.json` 已配置 output `apps/web/dist` 和 SPA fallback。
- App 状态主要通过 `loadAppState/persistAppState` 存在 localStorage。
- Web 接收扩展 hash payload：`#extension-import=...`。
- Web 通过 window message 与扩展 web-bridge 握手。
- 页面路由由前端 pathname 映射，并支持 `/albums/:albumId` 和 `/search?q=`。

目标状态：

- 页面组件拆分到 `apps/web/src/pages/*`。
- 状态层从 App 组件中抽出，统一使用 repository/service。
- 本地数据底座从 localStorage 迁移到 IndexedDB。
- Web 继续作为批量整理、迁移、纠正、导出和管理中心。

## 3. apps/extension

当前状态：

- Manifest V3，版本 0.2.2。
- 权限包括 activeTab、scripting、storage、downloads、tabs。
- content scripts：
  - `web-bridge.js` 注入 Web 域，用于 READY/PING/PONG/SCAN_STATUS。
  - `xhs-scanner.js` 注入小红书域，用于扫描可见 DOM 和自动滚动。
- popup 支持扫描、自动加载更多、暂停、继续、筛选、导入 Web、导出 JSON 和 checkpoint。
- 构建产物位于 `release-artifacts/extension-beta` 和 ZIP，Web `/old-import` 可下载 ZIP。

目标状态：

- 仍保持用户主动点击和本地 DOM 读取原则。
- 扩展状态模型显式化为 ScanSession。
- 扫描 0 条和 0 新增要输出结构化原因。
- 导入协议从 hash payload 升级为更稳的 IndexedDB handoff、Web message 或文件导入方案，避免 URL 过长。
- 正式商店发布前补权限说明、隐私政策、最小权限审计和商店账号。

不得做：

- 不模拟登录。
- 不绕过验证码。
- 不云端抓取。
- 不扫描用户未加载或不可见内容。

## 4. apps/mobile

当前状态：

- `apps/mobile` 只有 TypeScript skeleton 和分享入口 adapter 预留。
- Web 中有手机页面原型，但不是可上架 App。

目标 App 架构：

- Expo / React Native 主 App。
- 复用 shared-types、import-service、search-service、recommendation-service。
- Android 使用 `ACTION_SEND` / `ACTION_SEND_MULTIPLE` 接收 URL 和文本。
- iOS 使用 Share Extension 接收 `NSExtensionItem` 中的 URL/text，并通过 App Group 传给主 App。
- App 本地缓存使用 SQLite/AsyncStorage，云同步后接同一用户账号。

明确限制：

- 手机 App 不能安全直接读取完整小红书收藏夹。
- App 不应被实现成简单 WebView 后宣称完成原生分享入口。

## 5. api/functions

当前状态：

- `api/ai.ts` 是 Vercel Function。
- 支持 mock fallback 和 openai-compatible provider。
- 缺少 AI Key 时返回结构化 fallback，不应在前端暴露真实 Key。

目标：

- 保持 AI Key 只存在服务端环境变量。
- 所有 AI 输出必须经过 schema normalization。
- 真实 AI 失败、超时、JSON 不合法时 fallback 到 mock。
- QA 和设置页显示 provider、model、fallback、last error，但不泄露环境变量。

## 6. shared packages

当前可复用包：

- `shared-types`：核心类型和 schemaVersion。
- `classification-service`：Rule / Semantic prototype / Hybrid 分类，已有评估集。
- `ai-service`：AI Provider、Mock、OpenAICompatible、HTTP client、prompt/schema。
- `import-service`：ImportBatch 管线、parseShareInput、去重、SmartAlbum 生成。
- `database`：localStorage state 规范化、旧数据迁移、记录创建。
- `action-card-service`：SmartAlbum 和 Plan 相关生成。
- `search-service`：关键词搜索和匹配原因。
- `recommendation-service`：今日推荐。
- `storage-service`：StorageAdapter、LocalStorageAdapter、SupabaseAdapter 阻塞占位。

这些代码不应默认推倒重写。后续优先做的是隔离 UI、迁移存储和补足模型边界。

## 7. Web IndexedDB

当前 localStorage 可以继续支撑小规模测试，但不适合几千条收藏：

- 单 key 大 JSON 读写会阻塞主线程。
- 任意一次状态更新都可能重写整个 AppState。
- localStorage 容量和浏览器策略不稳定。
- 无法高效查询、分页和增量同步。

目标 IndexedDB：

- object stores：savedItems、importBatches、importBatchItems、smartAlbums、albumMemberships、actionCards、planCards、classificationCorrections、searchIndexes、scanSessions、migrationBackups。
- 所有写入走 repository。
- 支持分页、索引、批量事务和迁移备份。

## 8. extension chrome.storage.local

扩展侧继续使用 `chrome.storage.local` 保存：

- scan state。
- checkpoint。
- selected item ids。
- web app URL。
- extension settings。

但长期应避免把完整长期收藏数据放在扩展里。扩展只保存扫描会话和待导入临时结果，长期收藏由 Web/App 的数据层保存。

## 9. 未来 Supabase

Supabase 只在以下条件满足后启用：

- Supabase URL 和 anon key。
- Auth 登录方案。
- 数据库迁移脚本。
- Row Level Security。
- 本地数据迁移确认流程。
- 冲突策略。

当前 `SupabaseAdapter` 抛错是正确的安全边界，不能写假 adapter。

## 10. 同步策略

未来同步采用 local-first：

1. Web/App 本地写 IndexedDB。
2. 写入 SyncQueue。
3. 有网络和登录态时同步到 Supabase。
4. 冲突时用户手动字段优先，派生字段可重算。
5. 扩展导入先交给 Web，再由 Web 同步。

同步不应阻止本地使用。

## 11. 离线策略

- Web 离线可搜索已下载索引、查看收藏、编辑备注、生成本地规则分类。
- 真实 AI 依赖网络，离线 fallback 到 mock/rule。
- 扩展扫描依赖小红书页面已加载，不保证离线。
- 手机 App 离线可保存分享 payload，在线后同步。

## 12. AI Provider

当前 Provider：

- MockAiProvider
- OpenAICompatibleProvider
- AiHttpClient
- Vercel `/api/ai` proxy

目标：

- AI 只处理用户主动提供或确认导入的信息。
- Prompt 和 schema 单独维护。
- 分类输出必须包含 contentDomain、contentSubDomain、savedIntent、confidence、reason。
- ActionCard 按需生成。
- SmartAlbum 可由真实 AI 优化标题和描述，但 membership 必须尊重用户手动操作。

## 13. 搜索架构

当前搜索是本地关键词匹配，覆盖：

- displayTitle
- cleanedTitle
- rawTitle
- userEditedTitle
- userNote
- visibleText
- keywords
- entities
- contentDomain/contentSubDomain
- savedIntent
- actionCard fields
- SmartAlbum title/why/suggestedFirstAction

目标：

- IndexedDB 阶段建立 SearchIndex store。
- 云同步后可选 Supabase full-text。
- 语义搜索在 AI/embedding 阶段接入，但第一目标仍是“精准找回原帖”。

## 14. 扩展消息协议

当前协议：

- `COLLECTION_REVIVAL_EXTENSION_READY`
- `COLLECTION_REVIVAL_EXTENSION_PING`
- `COLLECTION_REVIVAL_EXTENSION_PONG`
- `COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS_REQUEST`
- `COLLECTION_REVIVAL_EXTENSION_SCAN_STATUS`
- `REVIVAL_GET_PAGE_STATUS`
- `REVIVAL_START_SCAN`
- `REVIVAL_PAUSE_SCAN`
- `REVIVAL_RESUME_SCAN`
- `REVIVAL_GET_SCAN_STATE`
- `REVIVAL_CLEAR_SCAN_STATE`

目标：

- 保持 protocolVersion。
- 所有 Web 消息包含 requestId。
- status payload 包含 scanSessionId、stage、blockedReason、counts 和 updatedAt。
- Web 不直接信任扩展 payload，仍需 validate、dedupe 和用户确认。

## 15. Android ACTION_SEND

Android 设计：

- 支持 `android.intent.action.SEND` text/plain。
- 支持 URL、title、raw text。
- `ACTION_SEND_MULTIPLE` 只作为后续能力，不在 MVP 承诺。
- 进入 App 后先创建 ImportBatch，用户确认后保存 SavedItem。

## 16. iOS Share Extension / App Group

iOS 设计：

- Share Extension 读取 `NSExtensionItem` 的 URL/text。
- 只做轻量解析和临时保存，不在 extension 内跑复杂 AI。
- 使用 App Group 将 payload 写给主 App。
- 主 App 打开后进入 ImportBatch 确认流程。

## 17. 安全与隐私边界

- 不保存小红书账号密码。
- 不抓取原帖全文、评论区、博主主页或视频内容。
- 不绕过登录、验证码、风控或访问限制。
- 不把扩展扫描结果上传到第三方，除非用户登录并确认同步到自己的云数据。
- AI 只发送用户确认导入的分享文本和索引字段，不发送未确认扫描批量原始页面。

## 18. 部署结构

当前：

- Vercel production：`https://xiaohongshu-green.vercel.app`
- Framework：Vite。
- Root Directory：仓库根目录。
- Build Command：`pnpm --filter @revival/web build`。
- Output：`apps/web/dist`。
- SPA fallback：`/(.*) -> /index.html`。

扩展：

- unpacked Beta 和 ZIP 由本地 build 生成。
- 商店发布不在当前阶段。

手机：

- 尚未部署或上架。
