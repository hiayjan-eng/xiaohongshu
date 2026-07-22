# 连续实施阶段

## Phase 0：冻结和规格

目标：停止继续补丁式开发，建立产品、UX、领域模型、平台架构、迁移路线和 Codex 工作流。

不做什么：不改业务代码，不修 UI，不提交，不部署。

修改模块：只新增或更新 `docs/`。

数据迁移：无。

页面变化：无。

自动化测试：不要求跑完整 `pnpm check`，但应确认 `git status` 只出现文档变更。

人工验收：阅读 8 份规格文档，确认后续开发以这些文档为准。

风险：文档写成通用模板，没有结合当前代码。解决方式是引用现有 apps/packages、localStorage、extension、AI provider 和 E2E 状态。

停止条件：发现必须修改业务代码才能描述清楚时停止，不顺手修改。

工作量：M。

## Phase 1：数据底座

目标：把长期数据从 localStorage 迁移到 IndexedDB local-first，建立可回滚迁移和数据访问层。

Task 8 审计补充：Phase 1 的“迁移”与“正式启用”是两个独立状态。迁移完成后仍需 Runtime 等价性、source drift、Bootstrap Marker、Activation Journal、异步启动门和 Recovery Screen；在这些门未通过前，localStorage 继续是唯一权威数据源。

不做什么：不接 Supabase，不做登录，不重写分类，不改扩展扫描协议。

修改模块：

- `packages/storage-service`
- `packages/database`
- `apps/web` 数据读取/写入入口
- 新增 migration tests

数据迁移：

- localStorage AppState -> IndexedDB stores。
- 保留 localStorage 备份。
- 用户确认后应用，支持撤销。

页面变化：

- 设置页新增 IndexedDB 迁移预览。
- QA 显示 storage mode 和迁移状态。

自动化测试：

- storage adapter contract。
- localStorage fixture 迁移。
- SavedItem/ImportBatch/SmartAlbum/ActionCard/PlanCard 关系校验。
- `pnpm check`。

人工验收：

- 用户原浏览器 80 条收藏迁移预览。
- 应用迁移后搜索、专辑、收藏详情仍可用。
- 回滚后能回到 localStorage 状态。

风险：

- 迁移覆盖用户手动纠正。
- 大状态读写引发 UI 卡顿。
- IndexedDB 事务失败导致部分写入。

停止条件：

- 任何实体数量迁移前后不一致。
- 分类纠正、备注或手动专辑操作丢失。
- 无法回滚。

工作量：L。

## Phase 2：扫描可靠性

目标：把旧收藏扫描 Beta 从“能跑通”提升为可解释、可恢复、可诊断的产品 Beta。

不做什么：不改分类 taxonomy，不接真实 AI，不改 Web 主 UI 大结构，不做商店发布。

修改模块：

- `apps/extension/src/popup.js`
- `apps/extension/src/xhs-scanner.js`
- `apps/extension/src/web-bridge.js`
- `apps/web` 的 `/old-import` 状态展示
- shared ScanSession 类型

数据迁移：

- 将旧 scan state 映射为 ScanSession。
- 保留原 chrome.storage checkpoint。

页面变化：

- `/old-import` 明确区分 0 发现、0 新增、全重复、未识别页面、未连接、验证码、登录提示。

自动化测试：

- 现有 extension validate。
- Web handshake E2E。
- ScanSession payload schema tests。
- `pnpm check`。

人工验收：

- Edge 和 Chrome unpacked extension。
- 打开本人小红书收藏页。
- 扫描、自动加载更多、暂停、继续、恢复、筛选、导入。

风险：

- 小红书 DOM 改版。
- 扫描状态同步滞后。
- 误导用户以为能读取全部历史收藏。

停止条件：

- 扩展连接回归。
- 用户真实 Edge 扫描路径不能跑通。
- 出现绕过平台限制的实现倾向。

工作量：M。

## Phase 3：Web 核心体验

目标：收口今日复活、搜索、智能专辑、收藏详情和 PlanCard 的核心体验，减少信息层级混乱。

不做什么：不做视觉大改，不新增大功能，不自动创建多日计划。

修改模块：

- `apps/web/src/App.tsx` 逐步拆分 pages/components。
- `search-service`
- `action-card-service`
- `recommendation-service`

数据迁移：

- 不迁移底层数据，只补展示映射和必要 schema normalize。

页面变化：

- Dashboard 搜索首屏固定。
- SmartAlbum 列表两列以内，生命周期语义统一。
- 详情页区分 SavedItem 和 ActionCard。
- PlanCard 操作完整但轻量。

自动化测试：

- `/search?q=` 刷新。
- Dashboard 搜索。
- 专辑确认、归档、恢复。
- PlanCard 延期、改日期、取消、完成。
- `pnpm check`。

人工验收：

- 桌面 1440x900 和手机 390x844。
- 搜索结果无需滚很远即可使用。
- “查看并整理”不触发确认。

风险：

- 拆组件时引入回归。
- 把计划库重新做重。
- 专辑 lifecycle 文案和状态不一致。

停止条件：

- 任一核心路由白屏。
- Dashboard 搜索或专辑详情回归。
- production UI 与报告不一致。

工作量：L。

## Phase 4：云同步

目标：在 IndexedDB 稳定后接入 Supabase Auth + Postgres，让同一账号跨浏览器/设备看到同一批收藏。

不做什么：不在无凭证时写假 adapter，不绕过 RLS，不做复杂团队协作。

修改模块：

- `packages/storage-service`
- Supabase migrations
- Web auth boundary
- SyncQueue
- settings migration UI

数据迁移：

- IndexedDB -> Supabase。
- 用户确认迁移。
- 冲突策略：sourceUrl 去重，用户手动字段优先。

页面变化：

- 登录/退出。
- 云同步状态。
- 迁移确认。
- 设备状态。

自动化测试：

- storage adapter contract。
- RLS policy tests。
- local-only 模式仍可用。
- `pnpm check`。

人工验收：

- 未登录继续可用。
- 登录后跨浏览器同步。
- 退出后不泄露上一用户数据。

风险：

- RLS 错误导致数据泄露。
- 迁移覆盖云端已有数据。
- local-first 与云端冲突不清晰。

停止条件：

- 缺 Supabase URL、anon key、migration 权限或 RLS。
- RLS 未验证。
- 迁移冲突策略不清楚。

工作量：XL。

## Phase 5：手机 App MVP

目标：实现真实移动端 skeleton 和系统分享入口 MVP，服务新收藏低摩擦导入、搜索和日常复活。

不做什么：不承诺手机读取完整小红书收藏夹，不做 WebView 冒充原生，不上架。

修改模块：

- `apps/mobile`
- shared import/search/recommendation packages
- mobile share adapters
- 文档和真机测试脚本

数据迁移：

- 如果 Phase 4 已完成，App 接云同步。
- 如果未完成，App 仅本地缓存分享 payload，不与 Web 自动同步。

页面变化：

- 今日
- 搜索
- 收藏详情
- 快速导入
- 智能专辑轻量查看

自动化测试：

- TypeScript。
- share payload normalization unit tests。
- 不影响 Web `pnpm check`。

人工验收：

- Android ACTION_SEND。
- iOS Share Extension。
- 真机分享小红书链接和纯文本。

风险：

- 原生配置影响 monorepo 稳定。
- 没有 Apple/Google 开发者账号。
- 没有真机无法验证分享入口。

停止条件：

- 无真实设备却宣称分享入口完成。
- 依赖安装破坏 Web 构建。
- 外部账号缺失但开始上架流程。

工作量：XL。

## Phase 6：AI 与个性化

目标：在数据和体验稳定后，用真实 AI 提升分类、行动卡、专辑标题、搜索关键词和个人偏好。

不做什么：不把真实 AI 作为 E2E 默认依赖，不发送未确认扫描数据，不生成大量任务。

修改模块：

- `packages/ai-service`
- prompts/schemas
- `/api/ai`
- QA AI 状态
- 评估集和真实试用分析

数据迁移：

- 保存 AI generation metadata。
- 不覆盖用户纠正。

页面变化：

- AI 模式提示更明确。
- 低置信收藏补充备注后可重新生成。

自动化测试：

- mock 默认路径。
- schema validation。
- fallback tests。
- 分类评估集。
- `pnpm check`。

人工验收：

- 用户提供 API Key 后手动 smoke。
- 成本和失败原因可见。

风险：

- 真实 AI 输出不稳定。
- 成本不可控。
- Prompt 把用途误判成主题。

停止条件：

- 缺 AI API Key。
- JSON schema 不稳定。
- fallback 不可用。

工作量：M-L。

## Phase 7：商店发布

目标：把扩展和手机 App 从 Beta 推向公开发布前状态。

不做什么：不跳过隐私政策，不扩大权限，不承诺平台不允许的能力。

修改模块：

- extension manifest/permissions/privacy docs
- store assets
- mobile signing
- release docs
- support/feedback flow

数据迁移：

- 无直接数据迁移，但需要兼容 Beta 扩展状态。

页面变化：

- `/old-import` 从 Beta 安装说明升级为商店安装说明。
- 设置页增加版本和支持信息。

自动化测试：

- extension package validation。
- store build artifact check。
- Web regression。
- `pnpm check`。

人工验收：

- Chrome Web Store / Edge Add-ons draft。
- iOS/Android TestFlight/Internal testing。

风险：

- 审核拒绝。
- 权限说明不足。
- 用户误解扫描范围。

停止条件：

- 缺 Chrome/Edge/Apple/Google 开发者账号。
- 隐私政策未完成。
- 权限审计未通过。

工作量：XL。
