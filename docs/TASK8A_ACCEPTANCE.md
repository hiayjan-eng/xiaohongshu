# Task 8A 验收记录

## 结论

`TASK8A_ACCEPTANCE_STATUS: PASS_WITH_NON_BLOCKING_GAPS`

Task 8A 已在 `phase1-task8a-local-storage-runtime` 分支完成。Web 现在通过异步启动门加载现有 localStorage 数据，业务页面只在 Runtime 完成打开、健康检查和 hydrate 后渲染。当前唯一权威数据源仍是 localStorage；本任务没有实现 IndexedDbRuntime、Bootstrap Marker 或 activeStorage 切换，也没有打开正式 IndexedDB。

允许开始 Task 8B，但不允许合并 main、迁移真实数据或部署。

## 分支与范围

- 起点：`da48b5bb6c932af1a1e0ddd16774bc509ba608a9`
- 分支：`phase1-task8a-local-storage-runtime`
- main / origin/main 基线：`3b6e940a8ce724426f3924294e65a922556d18a3`
- 新增包：`packages/storage-runtime`
- Web 接入：`apps/web/src/runtime`、`main.tsx`、`App.tsx`、`ThemeProvider.tsx` 和局部启动样式
- 未修改扩展、分类服务、迁移执行器、activeStorage 或部署配置

## Runtime 契约

`@revival/storage-runtime` 定义 `StorageRuntime`、`RuntimeKind`、生命周期、能力、健康报告、加载结果、产品设置和安全错误模型。Task 8A 的生命周期为：

```text
closed -> opening -> open -> loading -> ready
                              -> degraded
                              -> failed
ready -> persisting -> ready / degraded
```

LocalStorageRuntime 的能力边界为：异步加载、持久化和安全健康检查；不声称支持事务、实体级 diff 或索引查询。Runtime 构造和 `open()` 均不读取数据，只有显式 `loadAppState()` 才读取旧主状态、主题和成就三个既有 key。

## LocalStorage 兼容行为

- 主状态：`collection-revival-system:v1`
- 主题：`collection-revival-theme`
- 成就：`collection-revival-achievements`
- 缺少主状态时返回现有首用 demo 的内存表示，但不立即写入任何 key。
- JSON 损坏、结构不合法或 schema 不支持时进入 degraded，阻止普通可编辑页面，且不以 demo 覆盖原始字符串。
- 写入通过串行队列执行；快速连续更新按顺序持久化，最终值为最新状态。
- 主题和成就进入 Runtime 产品设置边界；developerMode、QA、真实试用和扩展状态仍在边界之外。
- 本任务没有增加 localStorage key，也没有双写。

`packages/database` 新增纯只读的 `readLegacyAppState` 和导出的 `normalizeAppState`。旧 `loadAppState` / `persistAppState` 暂时保留兼容，但普通 App 启动和持久化不再直接调用它们。

## Web 启动门

`AppBootstrap` 使用单一 reducer 管理：`idle`、`opening_runtime`、`checking_runtime`、`loading_state`、`ready`、`degraded`、`failed`。只有 ready 才挂载 `AppContent`，因此不会先渲染空 AppState 再被 effect 写回。

启动流程为：

```text
create LocalStorageRuntime
-> open
-> readonly healthCheck
-> loadAppState
-> render AppContent(initialState, initialSettings, runtime)
```

generation guard 会忽略过期异步结果；StrictMode 的清理通过微任务和代次检查避免第一次探测挂载误关掉仍在使用的 Runtime。直接访问 `/settings/data-migration` 会绕过普通业务启动门，继续使用 Task 7 的只读迁移页面，因此损坏主 AppState 时仍可检查和下载原始备份。

## 持久化协调器

`RuntimePersistCoordinator` 统一串行 AppState 和产品设置写入，跳过首屏未变化的引用和值，保证 hydrate 后零写入。组件卸载后不会更新 React 状态；持久化失败会显示中文可见提示，并保留安全错误码。当前产品仍沿用“内存先更新、随后持久化”的既有交互，因此失败时会明确显示内存与磁盘可能不一致，但 Task 8A 不重写全部业务 action。

## 错误与恢复

- loading：显示启动步骤，不渲染业务页面。
- degraded：数据存在但无法安全识别；阻止普通编辑，提供前往数据检查入口。
- failed：浏览器存储无法读取；显示安全中文说明和白名单错误码。
- persist failure：业务页面顶部显示保存失败提示，不输出正文、备注、完整 URL、原始 JSON 或底层 cause。
- Task 8A 不做静默 fallback 到另一存储，也不删除或修复原数据。

## 测试与截图

新增 `@revival/storage-runtime` 契约与实现测试，以及 Web controller、浏览器启动和视觉测试。覆盖构造零读取、首屏零写入、损坏 JSON 不覆盖、schema 阻断、读写错误、写入串行、StrictMode、迁移页兼容、IndexedDB 零访问和移动端无横向溢出。

截图目录：

- `apps/web/test-results/task8a-runtime-bootstrap/desktop-1440-loading.png`
- `apps/web/test-results/task8a-runtime-bootstrap/desktop-1440-degraded.png`
- `apps/web/test-results/task8a-runtime-bootstrap/desktop-1440-failed.png`
- `apps/web/test-results/task8a-runtime-bootstrap/desktop-1440-ready.png`
- `apps/web/test-results/task8a-runtime-bootstrap/mobile-390-loading.png`
- `apps/web/test-results/task8a-runtime-bootstrap/mobile-390-degraded.png`
- `apps/web/test-results/task8a-runtime-bootstrap/mobile-390-ready.png`

截图是本地验收产物，不提交 Git。

## 未关闭但不阻塞 Task 8B 的缺口

1. LocalStorageRuntime 仍整包序列化 AppState；实体 diff 和跨 Store 原子写属于 IndexedDbRuntime。
2. 当前业务 action 仍先更新 React 内存，再由协调器持久化；失败会明确告警，但尚未做到每个 action 持久化成功后才提交 UI。
3. IndexedDB 的 user、schemaVersion、数组顺序、hydrate/dehydrate 等价性尚未实现。
4. Bootstrap Marker、source drift、跨标签页 authority lock 和 activeStorage 选择属于 Task 8C / 8D。
5. 当前不得启用 IndexedDB，也不得把 Task 6/7 的 completed-not-activated 数据视为 active。

## Task 8B 接入点

Task 8B 应实现 IndexedDbRuntime 与 AppState round-trip 等价性，并复用当前 `StorageRuntime` 契约和 Web 启动门测试。它仍不得创建 Marker、切换 activeStorage 或接入普通 App；生产选择逻辑继续固定为 LocalStorageRuntime，直到 Task 8C/8D 完成授权和恢复协议。
