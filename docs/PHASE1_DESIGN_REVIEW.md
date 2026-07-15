# Phase 1 数据底座设计审查

本轮审查范围是现有 8 份产品与架构蓝图文档，以及当前仓库中已经存在的数据读写实现。结论是：大方向一致，核心流程已经稳定，但文档里有几处“目标架构”和“Phase 1 立即实现范围”混在一起的表述。如果直接按所有文档并集开发，会把 IndexedDB、本地迁移、专辑成员关系、扫描会话、云同步预留和页面重构一次性卷进来，风险过高。

Phase 1 应该被收窄为：建立可扩展的本地数据层、只读盘点旧 localStorage、提供备份/预览/校验/回滚设计，并为后续 IndexedDB 实现留出清晰边界。浏览器扩展、分类体系、页面主流程、Supabase、真实 AI、移动 App 都应冻结。

## 文档一致性结论

| 文档 | 当前结论 | Phase 1 采纳方式 |
|---|---|---|
| PRODUCT_BLUEPRINT | 核心流程清晰：扫描或分享导入 -> 收藏索引 -> 主题和用途整理 -> 搜索找回 -> 用户选择复活 -> 按需生成行动卡 -> 主动加入轻量计划。 | 全量采纳，作为 Phase 1 不破坏的产品边界。 |
| UX_SPEC | 页面职责基本明确，强调 QA / 真实试用不进入普通侧边栏，设置页承载数据管理入口。 | 只采纳“设置 -> 数据管理”的迁移 UI 入口，不做页面布局重构。 |
| DOMAIN_AND_DATA_MODEL | 目标实体完整，包含 ScanSession、AlbumMembership、User、Device、SyncQueue 等未来模型。 | Phase 1 只落地本地数据底座相关模型；ScanSession、AlbumMembership、User/Device/SyncQueue 延后。 |
| PLATFORM_ARCHITECTURE | 平台分工正确：扩展负责批量扫描，Web 负责整理管理，手机 App 负责分享导入和日常复活。 | 采纳平台边界，明确 chrome.storage.local 不进入 Web StorageAdapter。 |
| MIGRATION_ROADMAP | 已强调 localStorage -> IndexedDB 必须可预览、可备份、可回滚。 | 全量采纳迁移原则，但缩小首版 stores，不实现全文搜索、embedding、Supabase。 |
| IMPLEMENTATION_PHASES | Phase 1 定义为数据底座，不能扩展到 UI 重构和云同步。 | 采纳阶段边界，后续每个任务独立验收。 |
| CURRENT_GAP_AUDIT | 指出 localStorage 单 key、扫描 0 新增状态、专辑生命周期等真实差距。 | Phase 1 只处理数据底座，其他体验问题不在本轮实现。 |
| CODEX_WORKFLOW | 要求先审计、再设计、再实现，禁止跨阶段顺手修改。 | 全量采纳，本轮只产出 docs，不 commit、不 deploy。 |

## 冲突清单

| 冲突点 | 当前表现 | 建议采用的唯一版本 |
|---|---|---|
| SmartAlbum 成员关系 | DOMAIN_AND_DATA_MODEL 提到未来 `AlbumMembership`，当前代码中 `SmartAlbum` 使用 `savedItemIds`、`recommendedItemIds`、`suggestedItemIds`、`manuallyAddedItemIds`、`manuallyRemovedItemIds` 数组。 | Phase 1 继续迁移数组模型，不新增 `AlbumMembership` store。只有当数组模型影响性能或手动成员审计时，才在 V2 引入 `AlbumMembership`。 |
| ScanSession 与 ImportBatch | 文档目标里有 `ScanSession`，当前 Web 已用 `ImportBatch.scanSummary` 和 `ImportBatchItem` 保存导入批次；扩展扫描断点在 `chrome.storage.local`。 | Phase 1 不创建 `scanSessions` store。Web 只迁移已有 `ImportBatch` / `ImportBatchItem` / `scanSummary`，扩展断点仍由扩展管理。 |
| SearchIndex 是否独立 | 蓝图提到未来 SearchIndex，当前搜索依赖 `SavedItem.searchableText`、title、keywords、entities、ActionCard 字段和 SmartAlbum 标题。 | Phase 1 不实现全文搜索引擎，也不建 embedding store。保留并迁移 `searchableText`，必要时在迁移后重建派生 searchableText。 |
| 用户/设备/同步队列 | DOMAIN_AND_DATA_MODEL 包含 User、Device、SyncQueue，PLATFORM_ARCHITECTURE 提到未来 Supabase。 | Phase 1 不引入云端 userId 强依赖。保留本地 `DEFAULT_USER`，只在 schema 里避免阻碍未来云同步。 |
| StorageAdapter 粒度 | `packages/storage-service` 已有实体方法接口，但本轮目标要求更通用的 get/getAll/query/transaction/exportSnapshot。 | Phase 1 新接口设计采用通用 store API，现有实体方法可作为兼容层包在 repository 上，不要求一次替换所有业务调用。 |
| 迁移 UI 是否属于 Phase 1 | UX_SPEC 和 IMPLEMENTATION_PHASES 都提到设置页数据管理入口，CURRENT_GAP_AUDIT 又指出多个页面体验问题。 | Phase 1 只允许“设置 -> 数据管理 -> 升级本地数据存储”的最小迁移 UI，不做今日复活、专辑页面、收藏池布局重构。 |
| Demo 数据与真实数据 | `loadAppState` 当前在主 key 缺失或 JSON parse 失败时会写入 demo AppState。 | Phase 1 迁移必须先做只读 snapshot，不允许在迁移入口调用会自动写 demo 的加载路径；demo seed 与真实数据要明确分离。 |
| 文本修复与存储迁移 | 文档里同时提到旧扫描文本修复和存储升级。 | 两者必须独立。存储迁移只搬运和校验数据，不自动应用文本清洗修复。 |

## 建议采用的 Phase 1 唯一版本

1. 数据底座先做 local-first IndexedDB，不接 Supabase，不做登录。
2. IndexedDB v1 只覆盖当前 Web 已真实使用的数据：SavedItem、ImportBatch、ImportBatchItem、SmartAlbum、ActionCard、PlanCard、ClassificationCorrection、SearchLog、settings、migrationMetadata、backups。
3. `AlbumMembership`、`ScanSession`、`SearchIndex`、`Device`、`SyncQueue`、embedding store 全部延后。
4. Web 主流程先通过兼容层读取“类似 AppState 的快照”，避免一轮内重写所有页面状态管理。
5. 扩展侧 `chrome.storage.local` 不进入 Web StorageAdapter，也不修改扩展 manifest、Bridge、selector、扫描进度、暂停继续和断点恢复。
6. 迁移必须由用户主动确认，不能页面打开即静默执行。
7. localStorage 原始数据在稳定观察期前不删除，只作为回滚来源保留。

## 延后内容

- Supabase 表、Auth、RLS、云同步和多设备冲突合并。
- Android / iOS 分享入口真实实现。
- Chrome / Edge 商店版扩展发布流程。
- `AlbumMembership` 独立成员关系表。
- `ScanSession` 独立扫描会话模型。
- `SearchIndex`、全文搜索引擎、向量 embedding 和语义检索索引。
- 页面级体验重构，包括今日复活布局、智能专辑拥挤问题、扫描 0 新增状态解释。
- 旧扫描文本自动修复。Phase 1 可以保留“文本修复预览”入口，但不能把它与存储迁移合并执行。

## 本阶段冻结内容

- 浏览器扩展 manifest、Bridge、content script、扫描 selector、自动滚动、暂停继续、断点恢复、导入协议。
- 分类 taxonomy、Rule / Semantic prototype / Hybrid provider、64 条评估集。
- 真实 AI Provider 运行时行为。
- Web 主导航、页面视觉和主要交互。
- Vercel 部署结构。
- 用户浏览器中的现有 localStorage 和 chrome.storage.local 数据。

## 编码前必须确认的问题

1. IndexedDB 封装使用浏览器原生 API 还是引入 `idb` 这类轻量库。建议 Phase 1 先评估现有依赖和 bundle 影响，再决定。
2. `collection-revival-real-user-tests:v1` 是否作为核心用户数据迁移，还是只进入备份快照。建议默认进入备份，并在 settings store 里保留一份可选迁移。
3. 成就数据目前单独保存在 `collection-revival-achievements`，Phase 1 应迁移到 settings key-value，还是单独 store。建议先放入 settings store，避免过度拆 store。
4. activeStorage 标识保存在哪里。建议使用一个很小的 localStorage 标识 `collection-revival-active-storage`，并在 IndexedDB `migrationMetadata` 中保存镜像；若 IndexedDB 打开失败，自动回退 localStorage。
5. 迁移期间是否允许继续导入。建议第一版锁定写操作，提示“迁移完成后再继续导入”，避免双写冲突。
6. 多标签页同时迁移如何互斥。建议使用本地迁移锁、BroadcastChannel 和过期时间。
7. localStorage JSON 已损坏时如何处理。建议迁移入口读取 raw string 并生成“无法解析但可导出备份”的报告，不调用会覆盖 demo 的 `loadAppState`。
8. 迁移报告是否需要用户可下载。建议必须可下载，作为后续排查和回滚依据。
