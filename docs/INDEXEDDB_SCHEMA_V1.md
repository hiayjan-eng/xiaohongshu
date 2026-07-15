# IndexedDB Schema v1 设计

IndexedDB v1 的目标是承接当前 Web MVP 已经真实产生的数据，而不是一次性把所有未来实体落地。它应该支持几千条收藏、批量导入历史、智能专辑、按需行动卡、轻量计划、分类纠正、设置和可回滚迁移。它不承担云同步、全文搜索引擎、embedding、扩展断点或 Supabase 表职责。

建议数据库名：`collection-revival-local`  
建议版本：`1`  
建议 schemaVersion：`indexeddb_v1`

## Store 总览

| store | 是否 v1 必需 | 说明 |
|---|---:|---|
| `savedItems` | 是 | 收藏索引主表。 |
| `importBatches` | 是 | 导入批次，包含扩展扫描导入和手动导入。 |
| `importBatchItems` | 是 | 批次明细，保留扫描原始文本、标题清洗和重复状态。 |
| `smartAlbums` | 是 | 智能专辑候选、已确认、已归档状态。 |
| `actionCards` | 是 | 用户按需复活后生成的行动卡。 |
| `planCards` | 是 | 用户主动加入今日/计划后的轻量计划卡。 |
| `classificationCorrections` | 是 | 用户手动纠正分类，优先级高于自动结果。 |
| `searchLogs` | 是，但可限量 | 用于最近搜索、搜索找回成就和行为诊断。 |
| `settings` | 是 | key-value 本地设置、主题、developerMode、成就 map、可选真实试用记录引用。 |
| `migrationMetadata` | 是 | 迁移状态机、报告、activeStorage 镜像、锁信息。 |
| `backups` | 是 | localStorage 原始快照和迁移前备份。 |

暂不创建：`albumMemberships`、`scanSessions`、`searchIndexes`、`embeddings`、`users`、`devices`、`syncQueue`、Supabase 云端表。

## savedItems

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `SavedItem.id` |
| 必要 index | `sourcePlatform`、`normalizedSourceUrl`、`contentDomain`、`contentSubDomain`、`savedIntent`、`status`、`createdAt`、`updatedAt`、`displayTitle` |
| 唯一约束 | 不建议在 IndexedDB index 层强制 `normalizedSourceUrl` unique，因为当前产品支持无 URL 收藏、重复候选和历史重复项。去重应在 import-service/repository 层处理。 |
| 可选字段 | `embedding`、`classificationShadow`、`positiveEvidence`、`negativeEvidence`、`conflictingEvidence`、`rawTitle`、`cleanedTitle`、`userEditedTitle`、`displayTitle`、`textNormalizationVersion` |
| schemaVersion | 使用全局 `schemaVersion`，单条记录可保留 `textNormalizationVersion`。 |
| 数据来源 | 手动导入、扩展导入、真实试用、未来手机分享入口。 |
| 用户直接编辑 | `userNote`、`userEditedTitle`、分类纠正后的主题/用途映射、`status`。 |
| 是否可重建 | 不可重建。`searchableText` 可重建，但原始导入文本、备注、sourceUrl、手动标题不可重建。 |

## importBatches

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `ImportBatch.id` |
| 必要 index | `source`、`status`、`createdAt`、`updatedAt` |
| 唯一约束 | 无 |
| 可选字段 | `scanSummary`、`errorMessage` |
| 数据来源 | 手动单条导入、扩展扫描导入、未来批量链接/书签/手机分享。 |
| 用户直接编辑 | 通常不编辑，属于审计历史。 |
| 是否可重建 | 不可完整重建。可以从 items 聚合数量，但无法还原原始导入时间和失败原因。 |

## importBatchItems

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `ImportBatchItem.id` |
| 必要 index | `batchId`、`normalizedSourceUrl`、`status`、`createdSavedItemId`、`duplicateOfSavedItemId`、`createdAt` |
| 唯一约束 | 无。重复项是业务事实，需要保存。 |
| 可选字段 | `rawTitle`、`cleanedTitle`、`userEditedTitle`、`displayTitle`、`visibleText`、`coverUrl`、`errorMessage`、`createdActionCardId` |
| 数据来源 | 扩展扫描 payload、手动导入解析结果。 |
| 用户直接编辑 | 后续可能允许用户修正标题；v1 先迁移已有字段。 |
| 是否可重建 | 不可完整重建。它记录了扫描时的原始候选和重复/失败状态。 |

## smartAlbums

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `SmartAlbum.id` |
| 必要 index | `status`、`albumView`、`albumType`、`contentDomain`、`savedIntent`、`updatedAt` |
| 唯一约束 | 无。相似专辑可能并存并由用户合并/归档。 |
| 可选字段 | `contentSubDomain`、`coverItemId`、`matchProfile`、`suggestedItemIds`、`manuallyAddedItemIds`、`manuallyRemovedItemIds`、`confirmedAt`、`archivedAt` |
| 数据来源 | import-service / album-service 生成，用户确认、改名、归档后更新。 |
| 用户直接编辑 | 标题、描述、确认/归档状态、手动加入/移出。 |
| 是否可重建 | 候选专辑可重建；已确认、已归档、手动成员调整不可自动重建，必须迁移。 |

## actionCards

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `ActionCard.id` |
| 必要 index | `savedItemId`、`category`、`subCategory`、`createdAt`、`updatedAt` |
| 唯一约束 | 不在 DB 层限制一个 SavedItem 只能有一张卡。当前主流程通常按需生成一张，但历史数据可能存在多张，迁移要保留。 |
| 可选字段 | `openOriginalFocus`、`fields`、`tasks` |
| 数据来源 | 用户点击复活后由 AI/mock provider 生成。 |
| 用户直接编辑 | 行动卡字段、任务状态、补充备注后重新生成。 |
| 是否可重建 | 不应静默重建。旧卡代表用户已确认过的行动建议。 |

## planCards

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `PlanCard.id` |
| 必要 index | `plannedDate`、`status`、`savedItemId`、`actionCardId`、`updatedAt` |
| 唯一约束 | 无。一个收藏可能在不同日期被多次计划，但业务层可限制 active planned 卡。 |
| 可选字段 | `sourceTitle`、`completedAt`、`cancelledAt` |
| 数据来源 | 用户主动把行动卡加入计划。 |
| 用户直接编辑 | 日期、状态、取消、延期、完成。 |
| 是否可重建 | 不可重建。计划状态是用户行为记录。 |

## classificationCorrections

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `ClassificationCorrection.id` |
| 必要 index | `savedItemId`、`correctedDomain`、`correctedIntent`、`createdAt` |
| 唯一约束 | 无。多次纠正要保留历史，当前有效值由 SavedItem 和最近 correction 决定。 |
| 数据来源 | 用户人工纠正分类。 |
| 用户直接编辑 | 是。 |
| 是否可重建 | 不可重建。 |

## searchLogs

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `SearchLog.id` |
| 必要 index | `query`、`createdAt`、`clickedSavedItemId` |
| 唯一约束 | 无 |
| 数据来源 | 全局搜索、搜索结果打开原帖。 |
| 用户直接编辑 | 否 |
| 是否可重建 | 可丢弃或限量迁移，但如果要保留搜索成就和最近搜索，应迁移最近 N 条。建议 v1 全量迁移并设置后续保留策略。 |

## settings

`settings` 使用 key-value 模式，`keyPath = "key"`。

| key | value | 说明 |
|---|---|---|
| `theme` | `{ themeId, updatedAt }` | 从 `collection-revival-theme` 迁移。 |
| `developerMode` | `{ enabled, updatedAt }` | 从 `developerMode` 迁移。 |
| `achievements` | `{ unlocked: Record<string, string>, updatedAt }` | 从 `collection-revival-achievements` 迁移。 |
| `realUserTestRecords` | `{ records, updatedAt }` 或只保留备份 | 是否进入 settings 需编码前确认；至少进入 backup snapshot。 |
| `storageRuntime` | `{ activeStorage, schemaVersion, updatedAt }` | IndexedDB 激活状态镜像，主标识仍建议保留一个极小 localStorage flag 方便启动判断。 |

## migrationMetadata

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `migration_<timestamp>` 或固定 `current` |
| 必要 index | `status`、`startedAt`、`completedAt`、`targetSchemaVersion` |
| 内容 | MigrationReport、状态机、checksum、brokenReferences、warnings、rollbackAvailable、lockOwner、lockExpiresAt。 |
| 是否可重建 | 不可完全重建，应持久保存最近迁移报告。 |

## backups

| 属性 | 设计 |
|---|---|
| keyPath | `id` |
| 主键 | `backup_<timestamp>` |
| 必要 index | `createdAt`、`sourceSchemaVersion`、`checksum` |
| 内容 | localStorage raw snapshot、分散 key snapshot、迁移前计数、checksum、app version/build hash。 |
| 是否可重建 | 不可重建。 |

## v1 不做的结构

- `albumMemberships`：先保留 SmartAlbum 数组字段。V2 再拆成员关系表。
- `scanSessions`：扩展断点和扫描状态仍在 `chrome.storage.local`。Web 只保留 ImportBatch/ImportBatchItem。
- `searchIndexes`：搜索先继续由实体字段和运行时逻辑完成。
- `embeddings`：无真实语义搜索，不建向量表。
- `users`、`devices`、`syncQueue`：等 Supabase/Auth 阶段再落地。

## Task 1 定稿：Store 与索引契约

本轮已经将 Store 名称和最小索引契约固化到 `packages/storage-service/src/contracts.ts`。该契约用于 Task 2 MemoryAdapter、Task 3 IndexedDbAdapter 和后续迁移验证器，不代表本轮已经创建 IndexedDB。

最终 v1 Store：

| Store | Record 类型来源 | 说明 |
|---|---|---|
| `savedItems` | `@revival/shared-types` 的 `SavedItem` | 收藏索引主表。 |
| `importBatches` | `ImportBatch` | 导入批次。 |
| `importBatchItems` | `ImportBatchItem` | 导入候选和扫描明细。 |
| `smartAlbums` | `SmartAlbum` | 智能专辑候选、确认和归档状态。 |
| `actionCards` | `ActionCard` | 按需复活生成的行动卡。 |
| `planCards` | `PlanCard` | 用户主动加入计划后的轻量计划卡。 |
| `classificationCorrections` | `ClassificationCorrection` | 用户人工分类纠正。 |
| `searchLogs` | `SearchLog` | 搜索行为记录。 |
| `settings` | storage-service 的 `StoredSetting` | 主题、成就、activeStorage、长期设置等 key-value。 |
| `migrationMetadata` | storage-service 的 `MigrationMetadata` | 迁移状态和报告元数据。 |
| `backups` | storage-service 的 `StorageBackup` | 迁移前快照备份。 |

最终索引契约：

| Store | Phase 1 index names |
|---|---|
| `savedItems` | `id`、`sourceItemId`、`normalizedSourceUrl`、`contentDomain`、`contentSubDomain`、`savedIntent`、`status`、`importedAt`、`updatedAt` |
| `importBatches` | `id`、`source`、`status`、`createdAt` |
| `importBatchItems` | `id`、`importBatchId`、`normalizedSourceUrl`、`status` |
| `smartAlbums` | `id`、`status`、`albumType`、`updatedAt` |
| `actionCards` | `id`、`savedItemId`、`status`、`createdAt` |
| `planCards` | `id`、`savedItemId`、`actionCardId`、`plannedDate`、`status` |
| `classificationCorrections` | `id`、`savedItemId`、`createdAt` |
| `searchLogs` | `id`、`createdAt` |
| `settings` | `id`、`key` |
| `migrationMetadata` | `id`、`status`、`createdAt` |
| `backups` | `id`、`createdAt`、`sourceStorage`、`sourceSchemaVersion` |

有几个索引名称是为了 Phase 1 后续迁移和查询语义预留的规范名，例如 `sourceItemId`、`normalizedSourceUrl`、`importedAt`、`ActionCard.status`。当前共享实体未必已经有完全同名字段，Task 2/3 实现时可以在 repository 或 schema metadata 中建立映射，但不能随意改变对外契约。这样做的目的是让业务查询不依赖某个历史字段名，也避免 IndexedDB 实现阶段把“字段清洗”和“底层索引命名”混在一起。

## Task 1 定稿：settings Store 范围

建议进入 `settings` Store：

- theme
- achievements
- 用户产品设置
- activeStorage metadata
- 文本迁移版本
- 数据迁移偏好
- 是否显示完成动效等长期用户设置

不进入普通用户 settings：

- QA write test
- real-user-tests 临时测试内容，默认只进入备份；是否迁移为内部 setting 需要用户明确选择。
- demo seed 状态
- E2E 临时标记
- 扩展扫描断点
- 扩展 Bridge 状态
- API Key
- AI 服务端环境变量

`developerMode` 可以作为 internal setting 表达，但默认不进入普通用户导出；Snapshot 只有明确包含 internal settings 时才包含它。

## Task 2 补充：schema 未变更，MemoryAdapter 用于验证契约

Task 2 没有创建 IndexedDB 数据库，也没有调整 v1 Store 清单。它只在 `packages/storage-service` 中实现 `MemoryAdapter`，用同一组 `StorageEntityName`、`StorageRecordMap`、`STORE_PRIMARY_KEYS` 和 `STORAGE_INDEXES` 验证 v1 schema 契约是否可被具体 Adapter 实现。

需要注意的实现细节：

- `settings` 的主键采用 `key`，其他 v1 Store 采用 `id`。
- `normalizedSourceUrl`、`sourceItemId`、`importedAt` 等索引仍是 Phase 1 统一查询契约的一部分；当前共享实体里尚未完全同名的字段，后续可在 repository 或 adapter metadata 层做映射。
- Task 2 没有新增 `albumMemberships`、`scanSessions`、`searchIndexes`、`embeddings`、`users`、`devices` 或 `syncQueue`。
- Task 3 的 IndexedDbAdapter 必须复用 Task 2 的 Adapter contract suite，证明 v1 schema 的 CRUD、索引查询、事务、Snapshot 和导入语义都成立后，才能进入真实迁移任务。
## Task 3 实现基线：IndexedDB v1 已按契约创建

Task 3 已在 `packages/storage-service/src/indexeddb-adapter.ts` 中实现真实 IndexedDB v1 schema。该实现只供 storage-service 单元测试和后续迁移任务使用，尚未接入 Web 运行时，也没有迁移用户真实 localStorage。

数据库名称为 `collection-revival-local`，schemaVersion 为 `1`。测试环境会为每个测试创建带随机后缀的独立数据库名，避免污染正式名称。正式 adapter 源码使用原生 IndexedDB API；测试使用 `fake-indexeddb` devDependency 注入 `IDBFactory` 和 `IDBKeyRange`。

v1 object stores、keyPath 和索引如下，以 `contracts.ts` 的 `STORAGE_ENTITY_NAMES`、`STORE_PRIMARY_KEYS`、`STORAGE_INDEXES` 和 `indexeddb-adapter.ts` 的 `INDEXED_DB_INDEX_KEY_PATHS` 为最终代码准绳：

| Store | keyPath | IndexedDB index name -> keyPath |
|---|---|---|
| `savedItems` | `id` | `id -> id`, `sourceItemId -> sourceItemId`, `normalizedSourceUrl -> normalizedSourceUrl`, `contentDomain -> contentDomain`, `contentSubDomain -> contentSubDomain`, `savedIntent -> savedIntent`, `status -> status`, `importedAt -> createdAt`, `updatedAt -> updatedAt` |
| `importBatches` | `id` | `id -> id`, `source -> source`, `status -> status`, `createdAt -> createdAt` |
| `importBatchItems` | `id` | `id -> id`, `importBatchId -> batchId`, `normalizedSourceUrl -> normalizedSourceUrl`, `status -> status` |
| `smartAlbums` | `id` | `id -> id`, `status -> status`, `albumType -> albumType`, `updatedAt -> updatedAt` |
| `actionCards` | `id` | `id -> id`, `savedItemId -> savedItemId`, `status -> status`, `createdAt -> createdAt` |
| `planCards` | `id` | `id -> id`, `savedItemId -> savedItemId`, `actionCardId -> actionCardId`, `plannedDate -> plannedDate`, `status -> status` |
| `classificationCorrections` | `id` | `id -> id`, `savedItemId -> savedItemId`, `createdAt -> createdAt` |
| `searchLogs` | `id` | `id -> id`, `createdAt -> createdAt` |
| `settings` | `key` | `id -> id`, `key -> key`, `category -> category`, `internal -> internal`, `updatedAt -> updatedAt` |
| `migrationMetadata` | `id` | `id -> id`, `status -> status`, `createdAt -> startedAt` |
| `backups` | `id` | `id -> id`, `createdAt -> createdAt`, `sourceStorage -> sourceStorage`, `sourceSchemaVersion -> sourceSchemaVersion` |

所有索引当前均为 `unique: false`。这保持了导入去重和业务冲突处理在 repository / import-service 层完成的边界，也避免 IndexedDB schema 在无 URL 收藏、重复候选或历史数据兼容场景中过早拒绝数据。v1 不使用 `autoIncrement`，adapter 不生成业务 id，也不补业务字段。

`onupgradeneeded` 只负责创建 v1 stores 和 indexes，不读取 localStorage，不写入业务记录，也不执行数据迁移。已存在 store 时，adapter 会在升级 transaction 中取得该 store 并补齐缺失 index；不会盲目删除或重建已有 store。后续真实迁移和 schema upgrade 需要在独立任务中设计版本分支，不能直接在 Task 3 的 v1 schema 内隐式处理。

仍未创建的结构保持不变：`albumMemberships`、`scanSessions`、`searchIndexes`、`embeddings`、`users`、`devices`、`syncQueue`、Supabase 表。扩展的 `chrome.storage.local` 扫描断点、popup 状态、bridge 状态和进度状态不进入 Web IndexedDB v1 schema。

## Task 6 补充：migrationMetadata 与 backups 的执行期扩展

Task 6 没有新增 v1 object store，也没有改变 keyPath 或 index。迁移执行器会在既有 `migrationMetadata` store 中保存 `MigrationExecutionMetadataRecord`，它在基础 `MigrationMetadata` 之上增加执行期字段：`executionStatus`、`previewId`、`backupRecordId`、`sourceSnapshotChecksum`、`activeStorageSwitched`、`rollbackAvailable`、`resumeCount`、`checkpoints`、`writtenCounts`、`verifiedCounts`、`expectedChecksums`、`targetChecksums` 和 `lastCheckpointAt`。这些字段都是 JSON-safe，写入前会清理 `undefined`。

`backups` store 仍使用 keyPath `id`。Task 6 写入的备份记录保留标准 `StorageBackup.snapshot`，并以扩展字段保存 `rawBackup`、`checksums` 和读取报告，目的是让回滚和后续审计能看到 Task 4 的原始证据链。它不代表已切换 activeStorage，也不会删除旧 localStorage。
## Task 6.1 Backup Record Extensions

The `backups` object store still uses keyPath `id`, but Task 6.1 treats records as immutable migration evidence. A migration backup record keeps the standard `StorageBackup` fields and adds:

- `backupId`
- `sourceBackupId`
- `migrationId`
- `serializedEnvelope`
- `byteLength`
- `immutable: true`
- `verifiedAt`
- `rawChecksum`
- `normalizedChecksum`
- `rawBackup`
- `checksums`
- `report`

The primary checksum on the backup record is the SHA-256 of `serializedEnvelope`. The executor compares existing backup records inside a `backups` readwrite transaction. Same id and same immutable content may be reused; same id with different serialized content, checksum, byte length, migration id, or backup id blocks execution. The executor does not add extension data, browser bridge state, cookies, API keys, or chrome.storage.local content to this store.
