# Task 8 正式启用新存储前设计审计

## 1. 审计结论

本审计基于 Task 7C HEAD `24aedbeaf6a2faf3a9a738abde332783a3f0e0d3` 的真实代码。当前迁移、校验、Resume 和 Rollback 已经具备，但产品 Runtime 仍完全以旧 `localStorage` 为权威源。现在不能直接把 `activeStorageSwitched` 改成 `true`，原因不是 IndexedDB Adapter 不可用，而是启动、写入、顺序恢复、源数据漂移和失败恢复还没有形成一个闭合协议。

`TASK8_DESIGN_STATUS: READY_FOR_TASK8A`

Task 8A 已完成后的实施状态为：`TASK8A_IMPLEMENTATION_STATUS: PASS_WITH_NON_BLOCKING_GAPS`。启动门、LocalStorageRuntime 和持久化协调器已经落地，原 blocking 1、2 已关闭；产品仍固定使用 localStorage，尚未创建 Marker 或启用 IndexedDB。下一步设计门为 `READY_FOR_TASK8B`，但仍不允许 activeStorage 切换、合并 main 或部署。

这个状态表示设计已足够开始 Runtime 契约和 LocalStorage 兼容层，不表示允许切换 activeStorage、合并 main 或部署。

## 2. 当前启动链

```text
apps/web/src/main.tsx
  -> React.StrictMode
  -> App()
  -> useState(() => loadAppState(window.localStorage))
  -> packages/database.loadAppState
  -> getItem("collection-revival-system:v1")
  -> JSON.parse + normalizeAppState
  -> 缺失或解析失败时 createInitialDemoData + setItem
  -> React 首次渲染
  -> useEffect(state) -> persistAppState -> setItem(完整 AppState)
```

关键代码位置：

- `apps/web/src/main.tsx:6-10`：StrictMode 直接挂载 App，没有启动门。
- `apps/web/src/App.tsx:198-230`：AppState、主题和成就在 render 阶段同步读取。
- `apps/web/src/App.tsx:259-271`：AppState 与成就变化后直接持久化。
- `packages/database/src/index.ts:22-45`：旧 key、demo fallback 和整体 JSON 写入。

当前同步初始化有三个安全后果：

1. IndexedDB 异步加载时不能直接替换 `useState` initializer。
2. 若先渲染空 AppState，现有 effect 会把空状态写回权威存储。
3. StrictMode 下必须保证 boot 幂等，不能把重复 effect 当成第二次激活。

## 3. 当前写入链

```text
页面事件
  -> App.tsx 中约 30 组 setState / setUnlockedAchievements / setThemeId
  -> React 内存状态先变化
  -> useEffect
  -> persistAppState / persistUnlockedAchievements / ThemeProvider
  -> localStorage.setItem
```

主数据没有按实体 Repository 写入。收藏导入、分类纠正、专辑、行动卡、计划卡、文本迁移和撤销都先修改完整 AppState，随后由同一个 effect 整包序列化。写入失败不会撤销内存状态，`persistAppState` 也没有 quota 或 JSON 失败处理。

## 4. localStorage 调用盘点

在 `apps/web/src`、`packages/database/src` 和 `packages/storage-service/src` 的 production TypeScript 源码中，共识别到 25 个具体 `getItem/setItem/removeItem` 调用点：12 个读取、12 个写入、1 个删除。传入 `window.localStorage` 的调用边界另见 App 初始化和迁移 Controller。

| 类别 | key / 数据 | 主要调用点 | 读写 | Task 8 处理 |
|---|---|---|---|---|
| 产品主数据 | `collection-revival-system:v1` | `packages/database/src/index.ts:24-45`、`App.tsx:199,260` | 读写 | 必须进入 Runtime；IndexedDB 激活后旧 key 只读 |
| 外观设置 | `collection-revival-theme` | `themePresets.ts:153-155`、`ThemeProvider.tsx:9-18` | 读写 | 进入 settings Store 和 Runtime |
| 成就 | `collection-revival-achievements` | `App.tsx:228-230,269-271,4307-4319` | 读写 | 进入 settings Store 和 Runtime |
| 内部设置 | `developerMode` | `App.tsx:3590,4562-4576` | 读写 | 保持独立 internal key，不进入业务漂移 checksum |
| 内部测试 | `collection-revival-real-user-tests:v1` | `RealTestView.tsx:464-476` | 读写 | 继续独立，默认不进入 Runtime 或用户备份 |
| QA 探测 | `collection-revival-system:qa-write-test` | `App.tsx:4269-4304` | 临时写删 | 不迁移；未来 healthCheck 替代 |
| 迁移只读 | allowlist 六个 key | `migration-flow-controller.ts:331-343`、legacy reader | 只读 | 仅检查、漂移和备份使用 |
| Legacy Adapter | 主 AppState、成就 | `storage-service/src/index.ts:109-299` | 读写 | 仅兼容/回滚来源；不得成为 IndexedDB fallback writer |

结论：没有组件绕过 `persistAppState` 直接写主 AppState key，但主题、成就、developerMode、QA 和 RealTest 是独立写路径。Task 7 没有新增运行时 localStorage key，扩展的 `chrome.storage.local` 与 Web 不共享 key，也未发现 API Key、Cookie 或凭证写入 localStorage。

## 5. packages/database 与 storage-service 的职责冲突

当前 `packages/database` 同时承担：

- localStorage I/O；
- AppState normalize；
- demo seed；
- SavedItem/ActionCard 等记录创建；
- 文本迁移纯逻辑。

`packages/storage-service` 同时存在旧 `LegacyEntityStorageAdapter`、新 `StorageAdapter`、IndexedDbAdapter、迁移 Snapshot 和执行器。旧 LocalStorageAdapter 的实体方法仍整包读写 AppState，而通用 Store API 大部分明确不支持。

目标边界：

- `database` 暂时保留纯 codec、normalize、record factory 和 legacy schema 兼容；其 `loadAppState/persistAppState` 仅供 LocalStorageRuntime 包装，随后标记 deprecated。
- `storage-service` 负责 Adapter、Runtime、hydrate/dehydrate、diff、事务、health 和底层错误。
- Web 只通过 Runtime state controller 读写权威数据，不直接调用 Adapter、localStorage 或 `persistAppState`。
- Repository 在 Phase 1 后半逐步接管业务语义；Task 8 不一次性重写所有页面。

## 6. AppState 与 IndexedDB v1 可逆性

| AppState 字段 | IndexedDB 来源 | 当前完整性 | 顺序语义 | 结论 |
|---|---|---|---|---|
| `schemaVersion` | Snapshot header，未落 settings | 不完整 | 无 | 增加 `app.schemaVersion` setting |
| `user` | 无 Store、无 setting | 缺失 | 无 | 增加 `app.user` setting，不能只假设 DEFAULT_USER |
| `savedItems` | `savedItems` | 字段完整 | 有，首项和最近列表受影响 | 增加 order manifest |
| `actionCards` | `actionCards` | 完整 | 有 | 增加 order manifest |
| `planCards` | `planCards` | 完整 | 有 | 增加 order manifest |
| `classificationCorrections` | 对应 Store | 完整 | 审计/撤销顺序有意义 | 增加 order manifest |
| `searchLogs` | `searchLogs` | 完整 | 时间顺序有意义 | 可按 `createdAt,id` 恢复，并保存 manifest 兜底 |
| `smartAlbums` | `smartAlbums` | 完整 | 优先级和用户整理顺序有意义 | 增加 order manifest |
| `importBatches` | `importBatches` | 完整 | 最近批次顺序有意义 | 增加 order manifest |
| `importBatchItems` | `importBatchItems` | 完整 | 批次明细顺序有意义 | 增加 order manifest |
| 主题 | `settings:theme` | 已映射 | 无 | Runtime 接管 |
| 成就 | `settings:achievements` | 已映射 | 无 | Runtime 接管 |

当前 normalized Snapshot 不保存 `user` 和数组顺序；IndexedDB `getAll()` 的 object store cursor 是主键顺序，不能假设等于旧数组顺序。因此当前代码可以恢复业务记录集合，但不能生成与旧 AppState 等价的完整运行状态，不能直接激活。

Task 8B 必须扩展 legacy mapping，在 settings Store 写入：

- `app.user`
- `app.schemaVersion`
- `app.order.savedItems`
- `app.order.actionCards`
- `app.order.planCards`
- `app.order.classificationCorrections`
- `app.order.searchLogs`
- `app.order.smartAlbums`
- `app.order.importBatches`
- `app.order.importBatchItems`

这些是 JSON-safe 的 Runtime 元数据，不需要新 Store。旧迁移若缺少这些记录，不允许直接激活，应重新迁移或经过显式、可验证的 Runtime metadata preparation。

## 7. 派生数据

- `SavedItem.searchableText` 当前是持久字段，保持迁移，不在 Task 8 自动重算。
- 搜索结果、筛选结果、今日统计和推荐列表在内存重建，不落独立 SearchIndex Store。
- 智能专辑候选不在启动时重新生成；已迁移 SmartAlbum 为权威记录。
- embedding、页面缓存和临时推荐不进入 Phase 1 Runtime。
- 不在 hydrate 时重新分类、修复标题或覆盖用户调整。

## 8. Blocking 风险

1. App 没有 `booting/ready/recovery_required/boot_failed` 启动门。
2. 当前 effect 会在异步 hydrate 前写入空或默认状态。
3. `user`、App schema 和数组顺序未进入 IndexedDB Runtime 元数据。
4. 所有业务更新先改内存，持久化失败无法阻止成功 UI。
5. 没有单一 Runtime 选择协议或 Bootstrap Marker。
6. 迁移完成后的 localStorage 漂移尚未在激活前重新检查。
7. 没有跨标签页权威写锁，旧标签页可能在切换后继续写 localStorage。
8. `activeStorageSwitched` 当前类型和值都固定为 `false`，也没有 commit 协议。
9. Marker 与 IndexedDB 无法原子提交，尚无 Activation Journal 恢复算法。
10. 激活后 IndexedDB boot 失败时没有启动级 Recovery Screen。

这些问题已有明确设计归属，因此允许从 Task 8A 开始逐项实现；在 Task 8D 验收前都不得启用 IndexedDB。

## 9. 其他风险分级

### High

- 全量 AppState effect 持久化在几千条数据下性能和一致性不足。
- theme/achievements 与主状态分离，容易选错后端。
- IndexedDB `versionchange/blocked/quota/transaction abort` 尚未进入 App 启动恢复。
- Repository 索引契约中存在历史别名字段，Runtime 不应依赖缺失索引完成 hydrate。
- Recovery Screen、Activation Journal 类型和启动测试尚未实现。

### Medium

- 启动超时、进度文案和错误报告颗粒度尚未统一。
- 旧 localStorage 的长期保留期限没有产品设置。
- `indexedDB.databases()` 不可用时需要通过 Marker 和显式 open 行为区分正常启动与存在性探测。

### Low

- Runtime、Journal 和 Marker 的最终文件命名。
- 非阻断 warning 的 UI 排序。
- 后续把 App.tsx 中局部业务动作迁到 Repository 的节奏。

## 10. 文档冲突与修正

一致项：所有 Phase 1 文档都坚持备份优先、用户确认、不删除旧数据、扩展边界不变和不自动迁移。

冲突或过时项：

- `PHASE1_DESIGN_REVIEW` 曾建议 IndexedDB 打不开时自动回退 localStorage。正式激活后该策略会产生 split-brain，改为只读 Recovery Screen。
- `MIGRATION_ROADMAP` 把“写完后切到 IndexedDB”和“回滚清空新 Store”连成一个简单步骤。Task 7C rollback 只适用于 activation commit 前；commit 后需要反向迁移。
- `INDEXEDDB_SCHEMA_V1` 曾把 activeStorage 镜像描述为普通 settings。启动选择必须由独立 Bootstrap Marker 与 migrationMetadata 中的 Activation Journal共同判定。
- `PLATFORM_ARCHITECTURE` 把 database 视为持久化层。目标边界应由 storage-service Runtime 统一持久化，database 保留纯 legacy codec 和 domain factory。
- 旧文档未处理同步 App 初始化、源数据漂移、数组顺序和多标签页旧 Runtime 写入阻断。

## 11. 审计停止结论

本轮只产出设计。未修改 App、packages 运行代码或测试，未创建 Marker，未打开用户数据库，未迁移真实数据，未切换 activeStorage，未合并或部署。

## Task 8B 审计更新

原审计指出 IndexedDB 缺 user、App schemaVersion 和数组顺序，现已由 settings Store 中的版本化 Runtime metadata 与 order manifest 关闭。缺 metadata 的旧测试数据库会被阻止，不会猜测或回读 localStorage。Task 8B 尚未建立 Marker、Journal、source drift 或 authoritative source 切换，因此仍不可直接激活或部署。
## Task 8C 审计回填

设计中的关键高风险边界已经落地：固定 drift keys、完整 Runtime 等价、Store SHA-256、正式 Web Locks、单一写 gate、Marker revision/read-back、Journal create-or-reuse/read-back，以及 Marker 成功但 Journal finalization 失败时的 recovery_required。多标签页并发 Prepare 已在真实浏览器上下文收敛为单 Marker/单 Journal。仍延后的是 Task 8D 的 activating/indexeddb_active、正式启动 Recovery、controlled reload 和 commit transaction；Task 8E 负责真实 Profile、更多故障注入和发布门。
