# 迁移路线图

## 1. 当前实现与目标架构差距

当前 MVP 已经跑通主要闭环：扩展扫描、ImportBatch、SavedItem、搜索、智能专辑、按需 ActionCard、PlanCard、主题系统、AI fallback 和 E2E 门禁。真正的长期风险不在某个单点功能，而在数据底座和产品语义还没有完全稳定：

- `localStorage` 单 key 存储不适合数千条收藏。
- Web 的页面和状态集中在 `App.tsx`，继续补丁会让真实 UI 和报告越来越容易错位。
- 扩展有扫描状态，但 Web 还没有正式 ScanSession 模型。
- SmartAlbum 已有生命周期字段，但 membership 仍保存在数组里，批量移动和撤销会越来越复杂。
- 旧扫描文本迁移已有 `migrateScannedTextV3`，但应继续坚持“预览后应用”，不能自动改用户浏览器里的历史数据。
- QA / real-test 已隐藏在普通导航之外，但后续每轮上线必须真实验证 production UI。

目标架构是：Web IndexedDB local-first + 扩展 chrome.storage 临时扫描态 + 未来 Supabase 云同步 + 手机 App 分享入口。

## 2. localStorage 到 IndexedDB 迁移

### 当前状态

`packages/database` 使用 `STORAGE_KEY = collection-revival-system:v1` 存储整个 AppState。`packages/storage-service` 有 LocalStorageAdapter 和被阻塞的 SupabaseAdapter，但 Web 主流程仍直接 load/persist 整体 state。

### 目标状态

引入 IndexedDB adapter，至少包含：

- `savedItems`
- `actionCards`
- `planCards`
- `smartAlbums`
- `albumMemberships`
- `importBatches`
- `importBatchItems`
- `scanSessions`
- `classificationCorrections`
- `searchIndexes`
- `realUserTestRecords`
- `achievements`
- `migrationBackups`

### 迁移步骤

1. 只读扫描 localStorage，生成迁移预览。
2. 显示将迁移的 SavedItem、ImportBatch、ImportBatchItem、SmartAlbum、ActionCard、PlanCard 数量。
3. 导出备份 JSON。
4. 用户确认后，用 IndexedDB transaction 写入。
5. 写入成功后标记 `indexedDbMigration.completedAt`。
6. 保留 localStorage 原始备份，不立即删除。
7. 新读写切到 IndexedDB。
8. 提供回滚：清空本次 IndexedDB 写入，并恢复 localStorage 读取。

停止条件：

- 任何 store 写入失败。
- 迁移后数量和预览数量不一致。
- 用户手动分类纠正丢失。
- SavedItem 与 ActionCard / PlanCard 关系断裂。

## 3. 现有 80 条收藏和扫描批次迁移

用户提到当前可能有约 80 条真实收藏和扫描批次。迁移策略：

- 先按当前 schema normalize，但不自动重新分类。
- 保留 `rawTitle/rawShareText/visibleText/sourceUrl`。
- 派生 `displayTitle/searchableText` 可以重建。
- `contentDomain/savedIntent` 如果已有用户纠正，必须保留。
- `ImportBatch` 和 `ImportBatchItem` 先完整迁移，再建立 `createdSavedItemId` 引用校验。
- 对缺失 `createdSavedItemId` 的 batch item 保留为历史候选，不自动创建 SavedItem。

验收：

- 迁移前后 SavedItem 数量一致。
- ImportBatch 数量一致。
- 用户能打开旧批次最近扫描明细。
- 搜索能找到迁移前能找到的收藏。

## 4. 扩展状态兼容

当前扩展状态在 `chrome.storage.local`，Web 只读 scan status mirror。迁移不应要求用户重装扩展。

兼容策略：

- 保留现有 `revival-extension-scan-state` 和 checkpoint key。
- Web 迁移后仍能接收 hash payload。
- 新增 ScanSession 时，旧扩展 payload 可以在 Web 端生成 scanSessionId。
- 不修改 extension manifest、selector、bridge 和扫描协议，除非进入专门的扫描可靠性阶段。

停止条件：

- 旧版扩展无法导入 Web。
- Web 检测扩展连接变不稳定。
- 断点恢复数据被 Web 迁移误删。

## 5. SmartAlbum 迁移

当前 SmartAlbum 已支持主题视角和用途视角、candidate/confirmed/archived、matchProfile 和手动加入/移出字段。

短期迁移：

- 保留 SmartAlbum 数组字段。
- 补齐缺失 `albumView/status/schemaVersion`。
- `category/albumType` 继续兼容旧 UI。
- 对 `recommendedItemIds` 限制最多 3 条。

中期迁移：

- 引入 AlbumMembership store。
- 从 `savedItemIds/suggestedItemIds/manuallyAddedItemIds/manuallyRemovedItemIds` 生成 membership。
- SmartAlbum 本身只保存元数据、matchProfile 和计数缓存。

回滚：

- 保留 SmartAlbum 原始 JSON。
- 从 AlbumMembership 反向生成数组字段，供旧 UI 读取。

## 6. ActionCard / PlanCard 迁移

ActionCard：

- 保留已生成 ActionCard。
- 不为没有 ActionCard 的 SavedItem 自动补生成。
- 补齐缺失字段时只使用安全兜底文案。
- 低信息量卡片标记待补充，不自动重写用户已编辑内容。

PlanCard：

- 补齐 sourceTitle、plannedDate、estimatedMinutes、oneNextStep、doneCriteria、status。
- 取消态保留 cancelledAt，不删除。
- 完成态保留 completedAt。
- 延期只改 plannedDate，不创建副本。

## 7. 文本迁移和回滚

当前已有 `migrateScannedTextV3`，目标是继续加强而不是自动应用。

迁移要求：

- 覆盖 SavedItem、ImportBatchItem、最近扫描明细、收藏池、智能专辑显示和搜索索引。
- 规范字段：rawTitle、cleanedTitle、userEditedTitle、displayTitle、textNormalizationVersion。
- 保留 Emoji、合法特殊符号和用户编辑标题。
- 不粗暴删除 zero-width joiner。
- 无法判断的标题进入人工确认。

UI 流程：

1. 设置页点击“修复旧扫描文本”。
2. 生成预览：检查数量、异常数量、修改前、修改后、无法判断数量。
3. 用户导出备份。
4. 用户确认应用。
5. 更新 displayTitle 和 searchableText。
6. 支持撤销最近一次迁移。

## 8. 每阶段停止条件

通用停止条件：

- `pnpm check` 不通过。
- 分类评估低于既定门槛。
- production UI 与报告描述不一致。
- 迁移会覆盖用户手动分类或备注。
- 扩展扫描真实 Edge/Chrome 路径回归。
- 数据无法回滚。
- 外部凭证缺失但代码试图假连接。

## 9. 每阶段测试

自动化测试：

- typecheck。
- E2E：导入、搜索、专辑、PlanCard、真实分享文本、扩展握手、QA/real-test 隐藏。
- 分类评估集。
- IndexedDB migration unit tests。
- storage adapter contract tests。

人工验收：

- 干净浏览器。
- 用户原浏览器真实数据。
- 真实 Edge 扩展扫描。
- `/import`、`/old-import`、`/albums`、`/search`、`/settings` SPA 刷新。
- migration preview 不自动应用。

## 10. Production 验收

## Task 8 补充：迁移与激活分离

路线中的“新读写切到 IndexedDB”不再视为迁移 transaction 的最后一步。迁移 completed 后，localStorage 仍是权威源；正式启用前必须重新计算主 AppState、theme、achievements 的 source checksum，发现漂移则先 Rollback 并重新迁移。

正式切换采用 Prepare、controlled reload、IndexedDB boot verification、Commit 四段协议。Task 7C Rollback 只适用于 `activeStorageSwitched=false`；commit 后回到旧存储属于未来独立反向迁移，不能清空新 Store后直接恢复旧 writer。

每次生产发布后必须记录：

- commit hash。
- Vercel deployment id。
- local bundle hash。
- production bundle hash。
- 线上路径 `/`、`/import`、`/old-import`、`/albums`、`/albums/:albumId`、`/search?q=AI`、`/settings`。
- 扩展下载 ZIP 是否可用。
- 真实 UI 截图或浏览器自动化证据。

报告必须明确区分“干净 profile 验证通过”和“用户原浏览器仍需手动迁移预览”。
