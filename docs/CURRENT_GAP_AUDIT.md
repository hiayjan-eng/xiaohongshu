# 当前差距审计

## 1. 审计范围

本审计基于当前仓库结构、`apps/web/src/App.tsx`、`apps/extension`、`packages/*`、现有 E2E 和已有文档。它不是线上 smoke 报告，也不代表 production UI 已经与本地完全一致；后续每次发布都必须单独做线上验证。

## 2. 总览

| 模块 | 当前代码 | 最终蓝图 | 判断 |
| --- | --- | --- | --- |
| Web 工作台 | 已有完整 Vite SPA，页面多集中在 `App.tsx` | 批量整理、搜索、迁移和管理中心 | 可复用，但需要拆分和数据层隔离 |
| 浏览器扩展 | Manifest V3 Beta，扫描、滚动、暂停、断点、导入已具备 | 本机主动扫描旧收藏 | 可复用，不能推倒重写 |
| 手机端 | `apps/mobile` skeleton + Web 原型 | 原生分享入口和日常复活 | 需要新阶段开发 |
| 数据底座 | localStorage 单 key | IndexedDB local-first，未来 Supabase | 需要迁移 |
| 分类 | Rule/Semantic/Hybrid + 评估集 | 主题和用途分离，用户纠正优先 | 可复用，冻结 taxonomy |
| AI | Provider 架构和 server proxy | 真实 AI 可插拔，mock fallback | 可复用，真实 Key 后再优化 |
| 智能专辑 | 已有 status、matchProfile、详情路由 | 完整生命周期和 membership | 部分完成，需收口 |
| PlanCard | 已有轻量卡和操作 | 用户主动加入计划后展示 | 基本方向正确 |
| QA/真实试用 | 路由保留，普通导航隐藏 | 设置内开发入口 | 基本完成，但需线上确认 |

## 3. 值得保留的代码

- `packages/classification-service`：已有 hybrid provider 和评估集，不应在下一轮重构 taxonomy。
- `packages/import-service`：统一 ImportBatch 管线和 parseShareInput 值得保留。
- `packages/ai-service`：Provider、prompt、schema、fallback 结构已经正确。
- `packages/database`：schema normalize、记录创建、migrateScannedTextV3 是迁移基础。
- `packages/search-service`：匹配原因和 SmartAlbum 搜索已经可复用。
- `apps/extension`：用户已经在真实 Edge 跑通，manifest、bridge、selector、进度、暂停继续和导入协议在非扫描可靠性阶段不得修改。
- `apps/web/tests/e2e`：覆盖真实分享文本、AI fallback、分类质量、扩展握手和产品核心，是后续稳定门。

## 4. 需要重构的区域

### App.tsx 过重

当前 `App.tsx` 同时包含路由、状态、导入、搜索、智能专辑、计划、设置和多个页面组件。目标是拆成：

- `pages/DashboardPage`
- `pages/ImportPage`
- `pages/OldImportPage`
- `pages/AlbumsPage`
- `pages/SearchPage`
- `pages/PoolPage`
- `pages/SettingsPage`
- `state/appStore`
- `repositories/*`

拆分必须在数据底座阶段之后或同时进行，不能在当前冻结阶段顺手做。

### localStorage 性能和容量

当前 AppState 整体写入 localStorage。几千条收藏时会出现：

- 写入阻塞。
- JSON 体积接近浏览器限制。
- 搜索和渲染缺少分页。
- 迁移和回滚都只能处理整包状态。

必须迁移到 IndexedDB。

### SmartAlbum membership

当前成员数组适合 MVP，但不适合长期自动收纳、待确认新增、手动移出和撤销。目标是引入 AlbumMembership。

## 5. 需要迁移的区域

- localStorage -> IndexedDB。
- SmartAlbum 数组 membership -> AlbumMembership。
- 扩展 scan state -> ScanSession。
- 内联 searchableText -> SearchIndex store。
- 旧 category/status 文案 -> 新展示语义。
- 旧扫描标题 -> textNormalizationVersion V3+。

## 6. 应删除或隐藏的内容

- production 普通侧边栏不显示 QA / 真实试用。
- “暂不需要”这类不清楚的专辑操作文案应替换为“归档这个候选”。
- 任何让用户以为手机 App 能直接读取完整小红书收藏夹的文案都应删除。
- 任何未完成的批量导入、书签、手机分享入口只能 Coming soon，不能做成可点击主流程。
- 旧“其他行动卡”“行动卡行动卡”展示应继续通过 normalize 和迁移处理，不让新 UI 暴露旧兜底语义。

## 7. 当前阻塞

- 长期数据底座未迁移到 IndexedDB。
- 没有 Supabase 项目、Auth、RLS 和迁移权限，云同步不能开始。
- 没有 Apple/Google 开发者账号和真机验证，手机分享入口不能宣称完成。
- 没有 Chrome/Edge 商店账号和隐私政策，扩展不能商店发布。
- 真实 AI 生产 Key 未配置时只能 mock fallback。

## 8. 风险

1. 报告和线上 UI 不一致：必须每次记录 commit、deployment、bundle 和真实路径验证。
2. 扫描 0 新增含义不清：需要 ScanSession blockedReason 和用户可读诊断。
3. 数据迁移覆盖用户纠正：必须预览、备份、撤销。
4. 智能专辑确认和查看语义混淆：按钮行为必须固定。
5. localStorage 随收藏量增长变慢：数据底座阶段应优先。

## 9. 重点问题逐项审计

### 今日复活搜索和布局

当前状态：Dashboard 有内部搜索和 `/search?q` 跳转，E2E 覆盖 Dashboard 搜索。但真实反馈是结果需要向下滚动，桌面布局不合理。

目标状态：搜索位于首屏主操作区，最多显示 5 条，结果和今日计划并列或上下清晰分区。

处理建议：Phase 3 做体验收口，不在数据底座前大改。

### 扫描 0 新增的状态含义

当前状态：扩展和 Web 显示总数、新增、重复、缺标题、缺链接、阶段，但“0 条”背后的原因仍可能不够清楚。

目标状态：ScanSession 输出 blockedReason/noNewReason，Web 文案区分未识别页面、全重复、未加载、断点无新增、验证码、登录提示。

处理建议：Phase 2。

### 扫描断点和从头扫描

当前状态：扩展使用 `revival-extension-scan-state` 和 checkpoint，支持暂停继续、恢复和清空。

目标状态：用户能明确选择继续上次扫描或从头扫描，并看到会不会重复导入。

处理建议：保持现协议，补 UI 诊断，不改 selector。

### 查看并整理被错误触发为确认

当前状态：E2E 覆盖 `/albums/:albumId` 详情，列表有查看和确认操作，但真实 UI 仍需人工验证确保点击“查看并整理”不会改变 album.status。

目标状态：“查看并整理”只导航；“确认这个专辑”才改变状态。

处理建议：Phase 3 写专门回归测试和人工 smoke。

### 文本修复入口是否真实存在

当前状态：`migrateScannedTextV3` 存在，设置页有预览、应用、撤销相关测试。

目标状态：用户可导出备份、预览修改前后、应用和撤销；不会自动运行。

处理建议：Phase 1 纳入数据迁移流程。

### 专辑生命周期

当前状态：SmartAlbum 已有 `candidate/confirmed/archived`、confirmedAt、archivedAt、matchProfile、suggestedItemIds 等字段。

目标状态：列表、详情、自动收纳、待确认新增、归档恢复和批量操作语义完全一致。

处理建议：Phase 3 收口，不改分类服务。

### 本地存储容量和性能

当前状态：localStorage 单 key。

目标状态：IndexedDB object stores + SearchIndex + migrationBackups。

处理建议：Phase 1，优先级最高。

### 当前页面宽度和响应式

当前状态：CSS 已有多个 breakpoint、最大宽度和 mobile 响应式，但样式历史叠加很多。

目标状态：主页面宽度规则统一，智能专辑最多两列，Dashboard 首屏主操作清楚。

处理建议：Phase 3，避免现在视觉重构。

### QA / 真实试用

当前状态：`visibleNavItems` 根据 developerMode 隐藏 QA 和 real-test；设置页有开发与测试入口。

目标状态：production 普通用户不在侧边栏看到内部入口，但路由保留给测试。

处理建议：每次 production smoke 必验。

### Web / 扩展职责边界

当前状态：扩展扫描，Web 接收和整理；边界基本正确。

目标状态：扩展只做扫描和临时结果，Web 做长期数据和整理，手机做分享和日常复活。

处理建议：继续冻结边界，避免扩展承载分类或长期收藏存储。

## 10. 结论

当前系统不是要推倒重来。下一步应该先做数据底座和扫描状态可解释性，再收口 Web 核心体验。分类服务、导入管线、AI Provider、扩展扫描和 E2E 门禁都值得保留。
