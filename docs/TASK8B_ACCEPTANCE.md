# Task 8B Acceptance: IndexedDbRuntime 与往返等价

## 结论

`TASK8B_ACCEPTANCE_STATUS: PASS_WITH_NON_BLOCKING_GAPS`

Task 8B 在 `phase1-task8b-indexeddb-runtime` 分支完成，起点为 `86acdc29391de13e2ee3c42b9f615d359eb867d0`。IndexedDB 数据库仍为 `collection-revival-local`、schemaVersion 仍为 1，没有新增 Store、index 或 keyPath。Web 默认 Runtime 仍是 LocalStorageRuntime，本轮没有 Marker、activeStorage 切换、双写、真实迁移或部署。

## Runtime Metadata

schema v1 继续复用 `settings` Store，增加两个内部、版本化且不会进入普通设置 UI 的记录：

- `runtime:app-metadata:v1`：保存 `recordType`、metadata version、App `schemaVersion` 和完整 `user`。
- `runtime:order-manifest:v1`：保存八个 AppState 数组的 ID 顺序，包括显式空数组。

顺序清单覆盖 `savedItems`、`actionCards`、`planCards`、`classificationCorrections`、`searchLogs`、`smartAlbums`、`importBatches`、`importBatchItems`。读取时要求 ID 无重复，并且 manifest 与 Store 的 ID 集合完全一致；不使用 `getAll`、主键或 `createdAt` 顺序猜测原顺序。

产品设置继续沿用 `theme` 和 `achievements` 两条 settings 记录。developerMode、QA、real-test、扩展状态和 API Key 不进入 Runtime 数据。theme 或 achievements 缺失时只使用明确允许的默认值并产生 warning；Runtime metadata 缺失则是 blocking error。

## Migration Pipeline

Legacy Snapshot 在生成 normalized Snapshot 时，从通过映射后的实体记录生成 Runtime App Metadata 和 Order Manifest。因此未来重新执行 Task 7 迁移时，metadata 会作为 settings 记录进入现有 MigrationPlan，无需改变 Raw Backup 或 Backup Envelope 格式。

Migration Preview 新增 Runtime metadata 和顺序保留检查。Final semantic verification 复用同一检查：目标缺 metadata、user/schemaVersion 不一致、manifest 缺 ID/多 ID/顺序不同都会阻止 completed。Rollback 仍按原规则清理 settings 业务数据，保留 backups 和 migrationMetadata。旧测试数据库缺少 metadata 时，IndexedDbRuntime 返回 blocking error，要求 rollback 后重新迁移；不会猜 user、猜顺序或回读 localStorage。

## IndexedDbRuntime

构造函数只验证 Adapter kind，不打开数据库。`open()` 才调用 Adapter，并要求实际数据库 schemaVersion 与预期值严格一致。`healthCheck()` 使用只读事务检查 11 个 Store 可读、metadata、manifest、产品设置和跨 Store 引用；不会写记录，也不会读取 localStorage。

`hydrateRuntimeState` 在一个只读多 Store 事务取得实体和 settings 后，按 manifest 重建完整 AppState。`dehydrateRuntimeState` 是纯函数，输出八组实体记录、metadata、manifest、theme 和 achievements；不生成 MigrationMetadata、Backup 或激活数据，也不修改输入。

引用预检覆盖 ImportBatchItem、SmartAlbum、ActionCard、PlanCard 和 ClassificationCorrection 到其必需实体。断裂引用会在事务前拒绝，系统不会自动修复或级联删除。

## Diff And Transactions

`createRuntimeStateDiff` 使用主键 Map，复杂度接近 O(n)，输出每个 Store 的 create、update、deleteIds 和 unchangedCount。实体通过 canonical JSON 比较；Runtime settings 的 `updatedAt` 不作为业务变化。

- 仅顺序变化：只写 Order Manifest。
- 仅 user/schemaVersion 变化：只写 App Metadata。
- 仅 theme/achievements 变化：只写对应 settings 记录。
- 实体变化：只写 create/update，并只删除明确的 deleteIds。

一次 persist 使用一个覆盖全部 changed Stores 与 settings 的 readwrite transaction；不 clear Store，不 replace 全库，也不触碰 backups 或 migrationMetadata。事务完成后执行一次只读 change-set read-back，核对 create/update/delete 与 settings。事务失败不会部分提交；read-back 失败时已提交的数据保留现场，但 Runtime 报 `RUNTIME_VERIFICATION_FAILED` 并进入 degraded，不回退 localStorage，也不宣称保存成功。

持久化队列串行运行。调用方传入的 previous 必须与最近一次成功持久化 baseline 等价；过期 baseline 以 `RUNTIME_BASELINE_MISMATCH` 拒绝。失败后 Runtime 保持 degraded，后续写入不会继续假装成功；`close()` 等待队列收口。

## Round-trip And Shadow Compare

round-trip 比较覆盖 App schemaVersion、user、所有实体字段、全部数组顺序、theme 和 achievements。差异报告只返回安全路径和差异类型，不返回标题、备注、URL 或值。MigrationMetadata、Backup、Adapter 内部字段、developerMode、QA、real-test、扩展状态和 UI 临时状态不参与比较。

`shadowCompareRuntimeStates` 是显式调用的纯只读比较器，只比较两个已提供的 Runtime bundle，不访问或写入任何后端，也不决定 authoritative source。本轮没有 shadow write。

## Tests And Performance

- storage-runtime：37 tests / 129 assertions。
- storage-service：167 tests / 778 assertions。
- `pnpm typecheck`：passed。
- `pnpm check`：production build passed；Playwright 121 passed / 1 flaky。既有 real-test 用例首次等待超时，单独重跑 2/2 passed，未修改 Web。
- 覆盖 metadata/manifest、hydrate/dehydrate、diff、schema mismatch、缺 metadata、原子事务、read-back failure、队列、产品设置和迁移回归。
- 3,000 条 SavedItem 使用隔离 fake IndexedDB 完成写入、hydrate 和小 diff persist。
- 10,000 条 SavedItem 完成迭代式 codec round-trip，ID 顺序精确一致，无递归栈依赖。

性能测试只记录能力边界，不承诺毫秒 SLA。实现未出现按记录开启事务或 O(n²) 比较，小 diff 和 order-only 不会全量重写实体。

## Boundaries And Remaining Work

Web production Runtime factory 和 AppBootstrap 仍只创建 LocalStorageRuntime；普通启动不会打开 IndexedDB。没有创建 Bootstrap Marker、activeStorage key、Activation Journal 或 Source Drift 逻辑，没有写 `activeStorageSwitched=true`，没有双写，也没有修改扩展。

非阻塞缺口留给 Task 8C：activation 前 full hydrate + full equivalence、source drift、Marker 与 Activation Journal、切换前后恢复界面和 authoritative source 切换。Task 8B 允许进入 Task 8C，但不允许直接合并 main 或部署。
