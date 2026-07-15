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
