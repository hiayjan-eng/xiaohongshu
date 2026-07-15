# localStorage 使用盘点

本盘点只基于仓库代码，不读取、不修改用户真实浏览器数据。当前 Web 端核心状态仍然通过一个大对象写入 `localStorage`，扩展侧则通过 `chrome.storage.local` 保存扫描运行状态和断点。Phase 1 的关键不是简单替换 API，而是先保护这些真实数据，再把 Web 主状态迁移到可扩展的 IndexedDB。

## localStorage key 总览

当前代码中可确认的 Web `localStorage` key 共 6 个，其中 5 个会长期存在或承载用户数据，1 个是 QA 临时写入测试 key。扩展另有 3 个 `chrome.storage.local` key，它们不属于 Web StorageAdapter，但必须在迁移文档中明确边界。

| localStorage key | 数据结构 | 读写位置 | 是否必须迁移 | 是否可重建 | 风险 |
|---|---|---|---|---|---|
| `collection-revival-system:v1` | 整体 `AppState` JSON，包含 `schemaVersion`、`user`、`savedItems`、`actionCards`、`planCards`、`classificationCorrections`、`searchLogs`、`smartAlbums`、`importBatches`、`importBatchItems`。可能存在旧字段 `plans`、`realUserTestRecords`。 | `packages/database/src/index.ts` 的 `loadAppState` / `persistAppState`；`apps/web/src/App.tsx` 初始化和 effect 持久化；E2E helpers 直接读写。 | 必须迁移。 | 部分派生字段可重建，但原始导入、用户备注、手动纠正、批次历史不可重建。 | 单 key 大对象整体序列化，几千条收藏时容易接近容量限制；任意一次 stringify/setItem 失败都可能导致 UI 状态与磁盘状态不一致；`loadAppState` 在缺失或解析失败时会写 demo 数据，有误覆盖风险。 |
| `collection-revival-theme` | 主题 preset id，例如 `sprout`、`dawn`。 | `apps/web/src/theme/themePresets.ts`、`ThemeProvider.tsx`、`App.tsx` QA 状态读取。 | 建议迁移到 settings store，同时保留兼容读取。 | 可由默认主题重建，但用户选择会丢失。 | 低风险，但如果不迁移，升级后主题体验会回到默认。 |
| `collection-revival-achievements` | `{ [achievementId]: unlockedAt }` 成就解锁 map。 | `apps/web/src/App.tsx` 的 `loadUnlockedAchievements` / `persistUnlockedAchievements`；E2E helpers 清理和读取。 | 建议迁移。 | 不可靠。部分成就可从完成数据推导，但原始解锁时间不可重建。 | 与主 AppState 分离，容易在备份/迁移时遗漏。 |
| `developerMode` | 字符串 `"true"` / `"false"`。 | `apps/web/src/App.tsx` 的 `detectDeveloperMode`、SettingsView 开关、dev mode helper。 | 可选迁移到 settings store。 | 可以重建为默认 false。 | 低风险；影响 QA / 真实试用入口是否显示。 |
| `collection-revival-real-user-tests:v1` | `RealUserTestRecord[]`。 | `apps/web/src/components/RealTestView.tsx` 直接 load/persist；E2E real-test spec 清理和读取。 | 建议至少进入备份；是否进入 IndexedDB settings/auxiliary store 需编码前确认。 | 不可从主数据完整重建，因为评价字段、问题记录和导出总结可能只存在这里。 | 不在 AppState 中，容易被忽略；它是测试数据但可能包含用户真实评估。 |
| `collection-revival-system:qa-write-test` | 临时字符串 `"ok"`。 | `apps/web/src/App.tsx` 的 `getStorageStatus()` 设置后立即删除。 | 不迁移。 | 可重建。 | 仅用于检测 localStorage 可写性，无业务价值。 |

## chrome.storage.local key 边界

| chrome.storage.local key | 数据结构 | 读写位置 | Phase 1 处理 |
|---|---|---|---|
| `revival-extension-settings` | `{ webAppUrl }`。 | `apps/extension/src/popup.js`。 | 不进入 Web StorageAdapter；由扩展继续管理。 |
| `revival-extension-checkpoint` | 扫描断点：`items`、`selectedKeys`、`duplicateCount`、`pageUrl`、`savedAt`。 | `apps/extension/src/popup.js`、`apps/extension/src/xhs-scanner.js`。 | 不迁移到 Web；Web 只迁移已经导入形成的 ImportBatch / ImportBatchItem。 |
| `revival-extension-scan-state` | 扫描运行态：`status`、`stage`、`mode`、`limit`、`batch`、`lastAdded`、`noNewRounds`、`duplicateCount`、`missingLinkCount`、`missingTitleCount`、`totalFound`、`selectedCount`、`message`、`pageUrl`、`updatedAt`、`milestones`、`items`、`selectedKeys` 等。 | `apps/extension/src/popup.js`、`apps/extension/src/xhs-scanner.js`、`apps/extension/src/web-bridge.js`。 | 不纳入 IndexedDB v1。扩展断点保持在扩展侧，避免破坏已跑通的扫描链路。 |

## 主状态与派生数据

| 数据 | 当前位置 | 迁移判断 |
|---|---|---|
| SavedItem | `collection-revival-system:v1.savedItems` | 必须迁移。包含原始分享文本、标题、用户备注、分类结果、sourceUrl、searchableText 和状态。 |
| ImportBatch | `importBatches` | 必须迁移。它是扫描/手动导入批次历史，也是扩展导入可追溯性的核心。 |
| ImportBatchItem | `importBatchItems` | 必须迁移。包含扫描得到的原始标题、清洗标题、显示标题、可见文本、封面、重复/失败状态。 |
| SmartAlbum | `smartAlbums` | 必须迁移。尤其 confirmed / archived 状态、手动加入/移出、suggestedItemIds、matchProfile 不能丢。 |
| ActionCard | `actionCards` | 必须迁移。按需复活产生的行动卡是用户已整理成果。 |
| PlanCard | `planCards` | 必须迁移。包含 plannedDate、done/cancelled 状态、来源收藏等轻量计划信息。 |
| ClassificationCorrection | `classificationCorrections` | 必须迁移。它代表用户手动纠正，优先级高于自动分类。 |
| SearchLog | `searchLogs` | 可迁移但可降级。它用于最近搜索和成就触发，不是核心收藏内容。 |
| SearchableText / 搜索索引 | SavedItem 字段和运行时搜索逻辑 | 可重建，但建议 v1 迁移原值并在验证后按当前规则重建一遍，避免搜索断档。 |
| Theme | `collection-revival-theme` | 建议迁移到 settings。 |
| Achievements | `collection-revival-achievements` | 建议迁移到 settings。 |
| QA / demo 数据 | 主 AppState 或测试 helper 临时写入 | 不应无差别迁移为真实数据。迁移预览需要显示疑似 demo 数据数量，并允许用户决定是否保留。 |
| Extension 临时扫描状态 | chrome.storage.local | 不迁移。 |
| 旧扫描文本迁移状态 | 当前文本修复逻辑主要在 Web 状态和 UI 操作中体现 | 存储迁移只保留字段，不自动应用文本修复。文本修复预览/撤销独立处理。 |

## 直接读写位置

| 位置 | 行为 | 风险 |
|---|---|---|
| `packages/database/src/index.ts` | `loadAppState` 读取主 key，缺失或解析失败时写入 demo；`persistAppState` 整体写入主 key。 | 迁移入口必须绕过自动写 demo 的路径，直接读取 raw snapshot。 |
| `apps/web/src/App.tsx` | 初始化 `state` 时调用 `loadAppState(window.localStorage)`，每次 state 变化调用 `persistAppState`。同时直接读写成就、developerMode、QA storage status。 | 主流程没有经过 repository，Phase 1 需要兼容层，不能一口气改完所有 UI 状态。 |
| `apps/web/src/theme/ThemeProvider.tsx` | 主题变更直接写 `collection-revival-theme`。 | 迁移后需要统一到 settings repository，保留旧 key 读取兼容。 |
| `apps/web/src/components/RealTestView.tsx` | 真实试用记录直接读写 `collection-revival-real-user-tests:v1`。 | 这是直接绕过主 AppState 的用户数据，备份不能遗漏。 |
| `packages/storage-service/src/index.ts` | 已有 `LocalStorageAdapter` 和 `SupabaseAdapter`，但 LocalStorageAdapter 仍读写整体 AppState，SupabaseAdapter 全部 throw blocked。 | 可以复用名称和部分概念，但接口需要升级为通用 store + transaction + snapshot。 |
| E2E helpers | 测试直接 set/remove 主 key 和 achievement key。 | Phase 1 测试需要新增 IndexedDB fixture，同时保留 localStorage legacy fixture。 |

## 主要风险

1. **大对象单 key**：`collection-revival-system:v1` 把所有实体写成一个 JSON，数据量上来后会影响性能、容量和失败恢复。
2. **自动 demo 写入**：主 key 缺失或 parse 失败时自动写入 demo，迁移设计必须避免把“损坏状态”误变成“新 demo 状态”。
3. **分散 key 遗漏**：主题、成就、真实试用记录和 developerMode 不在主 AppState 中，若只迁移 `STORAGE_KEY` 会丢用户体验和测试反馈。
4. **旧字段兼容**：storage-service 里读 `plans`、`realUserTestRecords`，但共享 `AppState` 类型当前不包含这些字段，说明历史数据可能有未类型化字段。
5. **扩展状态边界**：扫描断点在 chrome.storage.local，Web 迁移不能假装能恢复扩展内部状态，只能保留已经导入 Web 的批次和明细。
6. **容量和序列化失败处理不足**：`persistAppState` 没有 try/catch，也没有 quota exceeded 的用户提示。IndexedDB 迁移前需要导出备份和校验报告。
