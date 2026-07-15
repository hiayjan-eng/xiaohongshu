# Phase 1 数据底座执行计划

Phase 1 不应该被作为一个大 Codex goal 一次性完成。它要拆成可以单独验收的小任务，每一步都要保护用户已有 localStorage 数据、扩展扫描链路和线上 Web MVP。除非任务明确允许，否则不修改扩展、不改分类、不改 UI 主流程、不接 Supabase、不部署 production。

## Task 1：存储盘点与 Adapter 接口定稿

| 项目 | 内容 |
|---|---|
| 目标 | 固化 localStorage 盘点、IndexedDB v1 store 范围、StorageAdapter 通用接口和 repository 边界。 |
| 修改文件 | `docs/*`，`packages/storage-service` 的类型草案或测试类型文件。 |
| 不修改文件 | `apps/web/src/App.tsx`、`apps/extension/*`、分类和导入业务逻辑。 |
| 输入 | 当前 8 份蓝图文档、`LOCAL_STORAGE_INVENTORY.md`、`INDEXEDDB_SCHEMA_V1.md`。 |
| 输出 | 最终接口设计、store 名称常量、迁移报告类型草案。 |
| 自动化测试 | typecheck；若新增类型，补最小单元测试。 |
| 人工验收 | 确认不涉及真实数据写入，不改变页面行为。 |
| 失败停止条件 | 发现必须改页面主流程才能定义接口，停止并重新拆任务。 |
| 是否允许 commit | 允许，前提是只含文档和类型设计。 |
| 是否允许 deploy | 不允许。 |
| 工作量 | S |

## Task 2：IndexedDB schema 和 MemoryAdapter

| 项目 | 内容 |
|---|---|
| 目标 | 实现可测试的 store schema 描述和 MemoryAdapter，先证明 CRUD/transaction/snapshot 接口可用。 |
| 修改文件 | `packages/storage-service`、相关测试文件。 |
| 不修改文件 | Web 页面、扩展、数据库真实迁移入口。 |
| 输入 | `INDEXEDDB_SCHEMA_V1.md`、`STORAGE_ADAPTER_DESIGN.md`。 |
| 输出 | MemoryAdapter、store schema metadata、snapshot/importSnapshot 测试。 |
| 自动化测试 | MemoryAdapter CRUD、bulkPut、transaction rollback、export/import snapshot。 |
| 人工验收 | 无 UI 变化。 |
| 失败停止条件 | 接口不能表达现有 AppState 或需要引入复杂云端 userId。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 不允许。 |
| 工作量 | M |

## Task 3：IndexedDbAdapter 基础 CRUD 和事务

| 项目 | 内容 |
|---|---|
| 目标 | 实现 IndexedDbAdapter 的打开 DB、建 store、索引、CRUD、bulkPut、transaction 和 schemaVersion。 |
| 修改文件 | `packages/storage-service`、测试配置。 |
| 不修改文件 | `apps/extension/*`、分类 taxonomy、AI provider、主 UI。 |
| 输入 | Task 2 的 schema metadata 和 MemoryAdapter 测试。 |
| 输出 | 浏览器环境可用的 IndexedDbAdapter。 |
| 自动化测试 | IndexedDB fake/浏览器测试；事务失败不产生半写入；索引查询正常。 |
| 人工验收 | 打开 Web 行为不变，因为尚未切换 activeStorage。 |
| 失败停止条件 | IndexedDB 在 Playwright 环境不稳定，或 schema 需要新增未审查 store。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 不允许。 |
| 工作量 | M |

## Task 4：只读 localStorage snapshot 和备份导出

| 项目 | 内容 |
|---|---|
| 目标 | 只读读取所有 Web localStorage key，生成 raw snapshot、counts、checksum 和可下载备份，不调用会自动写 demo 的 `loadAppState`。 |
| 修改文件 | `packages/storage-service` 或新建 migration utility，测试文件。 |
| 不修改文件 | 业务页面主流程、扩展。 |
| 输入 | `LOCAL_STORAGE_INVENTORY.md`。 |
| 输出 | `createLocalStorageSnapshot()`、checksum、backup JSON。 |
| 自动化测试 | 主 key 缺失、主 key 损坏、分散 key 存在、Emoji/中文保留、demo 数据识别。 |
| 人工验收 | 在本地测试 profile 导出备份，确认不会改 localStorage。 |
| 失败停止条件 | snapshot 过程写入任何业务 key，立即停止。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 不允许。 |
| 工作量 | M |

## Task 5：迁移预览与验证器

| 项目 | 内容 |
|---|---|
| 目标 | 从 snapshot 生成迁移预览和 MigrationReport，验证数量、引用、重复、日期、数组、中文/Emoji。 |
| 修改文件 | migration utilities、测试文件。 |
| 不修改文件 | 设置页 UI、activeStorage 切换、扩展。 |
| 输入 | Task 4 snapshot。 |
| 输出 | `previewMigration()`、`validateMigration()`、MigrationReport。 |
| 自动化测试 | broken SmartAlbum 引用、ActionCard 缺 SavedItem、PlanCard 缺 ActionCard、重复 URL、无 URL 收藏、分类纠正引用。 |
| 人工验收 | 通过 fixture 看到清晰 warnings，不切换存储。 |
| 失败停止条件 | 校验器无法区分 warning 与 blocking error。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 不允许。 |
| 工作量 | M |

## Task 6：迁移执行、断点恢复和回滚

| 项目 | 内容 |
|---|---|
| 目标 | 用户确认后写入 IndexedDB staging，校验通过后切换 activeStorage；失败可回滚。 |
| 修改文件 | storage-service migration executor、activeStorage resolver、测试文件。 |
| 不修改文件 | 扩展扫描逻辑、分类、AI、页面大布局。 |
| 输入 | Task 3 IndexedDbAdapter、Task 5 validator。 |
| 输出 | `runMigration()`、`rollbackMigration()`、迁移锁、BroadcastChannel 事件。 |
| 自动化测试 | 迁移中刷新恢复、重复执行不重复插入、失败不切换、回滚读取 localStorage、多标签锁。 |
| 人工验收 | 测试 profile 执行迁移，导出报告，回滚后数据仍在。 |
| 失败停止条件 | 任何场景会删除或覆盖 localStorage 原始数据。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 不允许，除非 behind dev flag 且默认不可见。 |
| 工作量 | L |

## Task 7：设置页迁移 UI

| 项目 | 内容 |
|---|---|
| 目标 | 在设置 -> 数据管理提供“升级本地数据存储”入口，支持查看预览、导出备份、开始升级、查看报告、恢复旧版本。 |
| 修改文件 | `apps/web` 设置页相关组件、迁移 UI 测试。 |
| 不修改文件 | 今日复活、专辑页面、扩展、分类和导入协议。 |
| 输入 | Task 4-6 的 migration API。 |
| 输出 | 用户可理解的迁移 UI，默认不自动执行。 |
| 自动化测试 | 未升级状态、预览、取消、导出、开始升级、完成、失败、恢复。 |
| 人工验收 | 使用测试 profile 走完整 UI；确认迁移中导入按钮被锁定或提示。 |
| 失败停止条件 | UI 在未确认时触发迁移，或迁移中出现无限 loading。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 可选。若功能默认稳定且 `pnpm check` 通过，可以作为 beta UI 部署；否则不部署。 |
| 工作量 | M |

## Task 8：切换 activeStorage 和 production 验收

| 项目 | 内容 |
|---|---|
| 目标 | IndexedDB 作为 activeStorage 后，导入、搜索、收藏池、专辑、行动卡、PlanCard、设置继续可用；localStorage 可回滚。 |
| 修改文件 | active storage resolver、AppState facade 或 repository 接入点、E2E。 |
| 不修改文件 | 扩展扫描内部逻辑、分类 taxonomy、真实 AI、Supabase。 |
| 输入 | Task 1-7 全部完成。 |
| 输出 | Phase 1 可上线版本。 |
| 自动化测试 | `pnpm check`、legacy localStorage fixture 迁移、IndexedDB clean profile、回滚、扩展导入 payload 写入 active adapter。 |
| 人工验收 | 干净浏览器和有旧数据浏览器各跑一遍；导入、搜索、确认专辑、生成行动卡、计划延期/取消、主题切换、扩展导入回归。 |
| 失败停止条件 | IndexedDB 打开失败无法回退，或任何用户数据丢失。 |
| 是否允许 commit | 允许。 |
| 是否允许 deploy | 允许，必须先通过完整门禁和 production smoke。 |
| 工作量 | L |

## 迁移影响矩阵

| 功能 | 影响等级 | 需要适配 | 回归重点 |
|---|---|---|---|
| 旧收藏扫描导入 | 高风险 | 导入 payload 进入 Web 后必须写 active Adapter；迁移中锁定写操作。 | 不修改扩展，验证导入后 ImportBatch / SavedItem / SmartAlbum 正常。 |
| 手动导入 | 需要适配 | 从 AppState setState/persist 迁到 facade/repository。 | 只填文本、含 URL 分享文本、重复 URL、无 URL。 |
| 收藏池 | 需要适配 | 读取 active Adapter 聚合结果。 | 标题、分类、状态、旧数据迁移后显示。 |
| 今日复活搜索 | 需要适配 | 搜索范围从 active data 读取。 | `/search?q`、Dashboard 搜索、空查询。 |
| 全局搜索 | 需要适配 | SearchLog 写入 active Adapter。 | 查询恢复、匹配原因、打开原帖。 |
| 智能专辑 | 需要数据迁移 | 保存 confirmed/archived/manual arrays。 | 确认、归档、恢复、待确认新增。 |
| 专辑确认与归档 | 需要适配 | SmartAlbum repository 更新。 | 手动移出不被自动塞回。 |
| 分类纠正 | 需要数据迁移 | correction store + SavedItem 更新。 | 用户纠正优先，不被重算覆盖。 |
| ActionCard | 需要数据迁移 | 按需生成后写 active Adapter。 | 不在导入时自动制造大量卡片。 |
| PlanCard | 需要数据迁移 | planned/done/cancelled 状态迁移。 | 来源收藏、延期、取消、完成。 |
| 文本修复 | 需要回归测试 | 与存储迁移分开，不自动应用。 | 预览、应用、撤销仍可用。 |
| 主题设置 | 需要迁移 | theme key -> settings store，保留兼容。 | 刷新后主题保持。 |
| QA / E2E | 需要适配 | 测试 helper 支持 localStorage legacy 和 IndexedDB。 | 旧 fixture、干净 profile、devMode。 |
| Vercel API | 无影响 | `/api/ai` 不依赖本地存储。 | fallback 仍正常。 |
| 浏览器扩展 | 高风险但不修改 | Web 接收导入 payload 写 active Adapter；扩展自身 chrome.storage.local 不动。 | 下载、连接、扫描、暂停继续、断点恢复。 |

## 特别决策

1. **扩展导入 payload 进入 Web 后走哪个 Adapter**：进入当前 active Adapter。未迁移时写 localStorage facade；迁移完成后写 IndexedDB facade。
2. **迁移期间是否允许继续导入**：不允许写操作。导入、复活、专辑确认和计划更新都显示“正在升级本地数据，请稍后再试”。
3. **多标签页同时迁移**：使用 localStorage 迁移锁 + BroadcastChannel。第二个标签页只能查看状态，不能启动迁移。
4. **localStorage 和 IndexedDB 不双向写入**：activeStorage 是单一写目标。localStorage 原始数据只读保留。
5. **activeStorage 标识保存位置**：localStorage 小 key + IndexedDB metadata 镜像。这样启动时能快速判断，但用户数据不放在该 key。
6. **数据库打开失败如何回退**：显示中文错误，自动切回 LocalStorageAdapter 只读/可用模式，并提示用户导出备份或稍后重试。

## 推荐第一实施任务

建议先做 Task 1。它的价值是把接口、store 边界、迁移报告类型和测试目标一次性定住，且不会触碰用户真实数据和业务页面。等 Task 1 通过后，再进入 MemoryAdapter 和 IndexedDbAdapter，实现风险会小很多。
