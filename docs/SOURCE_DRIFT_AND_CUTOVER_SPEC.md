# Source Drift And Cutover Spec

## 1. 漂移定义

Source drift 指 MigrationMetadata 记录的旧数据快照与激活时当前 legacy localStorage 不再一致。迁移 completed 到正式 activation 之间，用户仍可能导入收藏、改备注、纠正分类、整理专辑、创建行动卡或计划、完成计划、切换主题和解锁成就。直接启用旧的 IndexedDB 副本会丢失这些修改。

Phase 1 不做增量同步或自动合并。任何权威数据漂移都阻止激活。

## 2. checksum 范围

进入漂移 checksum：

- `collection-revival-system:v1` 原始字符串；
- `collection-revival-theme` 原始字符串；
- `collection-revival-achievements` 原始字符串。

不进入：

- `developerMode`；
- `collection-revival-real-user-tests:v1`；
- QA write test；
- E2E flag；
- extension `chrome.storage.local` checkpoint、popup、Bridge 和 progress；
- API key、Cookie 或环境变量。

使用 Task 4 的 allowlist、canonical JSON 和 SHA-256。比较两层：

1. raw checksum，捕获任何被纳入 key 的字节变化；
2. normalized checksum，确认业务 Snapshot 语义。

不得只比较数量、updatedAt 或单一实体集合。

## 3. 激活前判定

激活 preflight 需要同时验证：

- current raw checksum 等于 persisted Backup raw checksum；
- current normalized checksum 等于 MigrationPlan sourceSnapshotChecksum；
- Backup Envelope checksum 有效；
- IndexedDB 九个业务 Store checksum 等于 MigrationMetadata final target checksums；
- schemaVersion 为 1；
- Runtime settings 与 order manifests 完整；
- 没有其他未解决 migration 或 activation journal。

情况 A，完全一致：可以进入冻结窗口。

情况 B，任一 source checksum 不一致：阻止激活，保持 LocalStorageRuntime 可写，并显示：

> 当前收藏在迁移完成后又发生了变化。为了避免遗漏最新内容，需要重新检查并迁移后才能启用新存储。

处理路径：显式 Task 7C Rollback，重新运行检查、备份、预览和迁移，再做 activation preflight。不得自动覆盖、自动合并或使用旧 target。

## 4. 冻结窗口

第一次 checksum 通过后仍存在检查到切换之间的竞态，所以必须冻结：

1. 获取 `collection-revival:storage-authority` exclusive Web Lock。
2. 当前 Runtime 进入 `activation_preflight`，拒绝新的业务 action。
3. BroadcastChannel 通知其他标签页进入 stale/read-only。
4. 其他标签页的每次写前 Marker guard 也会拒绝写入。
5. 再次读取三个 source key 并重算 raw/normalized SHA-256。
6. 再次验证 target checksum、Backup、Metadata、schema 和 Runtime metadata。
7. 一致后写 prepared Journal；不一致立即解除冻结并回到 legacy_active。

禁用单个页面按钮不足以冻结，因为用户可能打开收藏池、扫描导入页或另一标签页。

## 5. 权威锁

现有 `collection-revival:migration-writer` 只保护目标迁移 writer，不足以约束旧 App 页面写入。Task 8 引入 `collection-revival:storage-authority`：

- LocalStorageRuntime 和 IndexedDbRuntime 的业务写获取 shared lock，并在 lock 内检查 Marker revision/backend。
- activation 获取 exclusive lock。
- reverse migration 未来也使用 exclusive lock。
- 不使用 Memory Lock 或 localStorage lease 作为 production fallback。
- Web Locks 不可用时不允许 activation。

迁移 writer lock 保留原职责，避免 Task 8 改坏 Task 6/7 的恢复语义。

## 6. 旧标签页处理

旧标签页即使没收到 BroadcastChannel，也必须在下一次写入前读取最小 Marker 并比较 runtime 启动时保存的 revision。发现以下任一变化就拒绝写：

- revision 改变；
- activeBackend 改变；
- state 为 activation_prepared、activating、indexeddb_active 或 recovery_required。

UI 显示“数据存储已在另一个页面发生变化，请刷新后继续”。不得把旧内存 state 写回 localStorage。

## 7. Cutover 成功条件

只有以下全部满足才允许从 boot verification 进入 commit：

- exclusive lock 仍持有；
- Marker 与 Journal activationId/revision 一致；
- source checksum 未漂移；
- target schema、count、Store SHA-256 和语义引用通过；
- IndexedDbRuntime hydrate 出完整 AppState；
- user、schema、order manifests、theme 和 achievements 已恢复；
- App 尚未开放业务写；
- MigrationMetadata 尚未 active。

commit 后 localStorage 主数据、theme、achievements保持原字节，只是失去权威写入资格。

## 8. 失败处理

- 漂移：回到 legacy_active，要求 rollback + 重新迁移。
- lock 被占用：等待或退出，不尝试无锁切换。
- 其他标签页不响应：exclusive lock 无法获取时阻止。
- Journal 写失败：不写 Marker，legacy 保持 active。
- Marker prepared 写失败：Journal 标 failed/cancelled，legacy 保持 active。
- reload 前崩溃：prepared/activating 状态由 Recovery Screen 处理。
- boot 校验失败：不写 activeStorageSwitched=true，进入 Recovery。
- commit 后 Marker 最终写失败：Journal committed 是恢复证据，Recovery 验证后补写 Marker。

## 9. 测试矩阵

- 无漂移；SavedItem 新增；userNote 修改；分类修改；专辑状态修改；PlanCard 修改；theme/achievements 修改。
- developerMode、QA、RealTest 和 extension checkpoint 变化不阻止。
- 第一次检查后、冻结前发生写入必须由第二次 checksum 捕获。
- 多标签页一边编辑一边激活，编辑或激活只能有一方获得 authority。
- BroadcastChannel 不可用时 Web Lock + Marker guard 仍阻止旧 writer。
- 3,000 与 10,000 SavedItem checksum 不依赖脆弱毫秒阈值。
- 错误报告不包含标题、备注、正文、完整 URL 或 raw JSON。

## 10. 非目标

不实现 delta migration、双向同步、last-write-wins、自动冲突合并、后台 shadow write、跨设备同步或 committed 后反向迁移。
