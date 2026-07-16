# Task 7B Acceptance

## 结论

`TASK7B_ACCEPTANCE_STATUS: PASS`

Task 7B 已在独立分支 `phase1-task7b-migration-execution-ui` 完成。分支起点为 Task 7A HEAD `5295ff473344bce549193cb66118da28d8052aad`。本轮允许进入 Task 7C，但在 Task 7C 完成刷新恢复、Resume 和 Rollback UI 前，不允许合并 `main`，也不允许部署给真实用户。

## 用户流程

设置页入口和 `/settings/data-migration` 路由保持不变，流程扩展为五步：检查数据、查看结果、保存备份、最后确认、执行升级。备份下载按钮必须真实触发 JSON 下载，随后用户逐项确认：旧收藏不会删除、已检查下载列表中的备份、当前产品仍使用旧存储、新存储下一阶段才启用。四项默认均未勾选，少一项都不能开始。

只有 Preview 可执行、blocking 为 0、manual review 为 0、Raw Backup 可用、下载已触发、四项确认完成、Web Locks 可用且用户点击开始后，Controller 才创建正式 Adapter。数据库名为 `collection-revival-local`，schemaVersion 为 1。

## 执行边界

生产运行工厂只创建 `IndexedDbAdapter`、`WebLocksMigrationLockProvider` 和 `MigrationExecutor`。Web 代码没有导入 `MemoryMigrationLockProvider`，没有传 `unsafeAllowProcessLocalLockForTests`，也没有无锁 fallback。Web Locks 不可用时会在创建 IndexedDB 前停止。

Controller 显式调用 Adapter 的 `isAvailable` 和 `open`，随后把 Task 7A 内存中的 envelope、preview、plan、`userConfirmed=true` 和 AbortSignal 交给 Task 6 Executor。现有 Executor 没有 `verifyAfterEachStore` 参数，因为逐 Store checksum 和内容校验是固定流程；Web 端没有增加虚构参数。执行结束、失败或取消后，Controller 在 `finally` 中关闭连接，close 失败只产生安全 warning。

真实 Chrome 验收发现 Web Locks API 不允许同时传 `ifAvailable` 和 `signal`。`WebLocksMigrationLockProvider` 已做最小修复：继续使用 `ifAvailable` 的非排队独占锁，在调用前和回调内检查取消，但不再传冲突的 `signal` 选项。新增 storage-service 回归测试覆盖该原生浏览器约束。

## 状态与页面

单一 reducer 增加：`awaiting_confirmation`、`checking_execution_support`、`opening_target`、`acquiring_lock`、`executing`、`cancelling`、`cancelled`、`verifying`、`completed_not_activated` 和 `execution_failed`。

进度页面直接消费 `MigrationExecutionProgress`，显示真实当前阶段、Store 中文名、已写记录、已验证模块和 ARIA progressbar。百分比由已完成 Store checkpoint 推导，不使用计时器。Store 中文名覆盖主题与成就、收藏、扫描与导入批次、导入明细、智能专辑、行动卡、计划卡、分类纠正、搜索记录、原始备份和升级记录。

安全停止使用 `AbortController.abort()`。Executor 不会强拆当前 Store 事务，而是在原子边界停止。取消页只说明旧存储仍在使用、备份和 metadata 保留；Task 7B 不显示继续升级或恢复按钮。失败页显示安全中文信息和折叠错误码，不展示 DOMException、正文、备注、完整 URL 或 token。

成功状态固定为 `completed_not_activated`。页面明确显示当前使用旧本地存储、新存储已准备但尚未启用、原始数据仍然保留，并提供升级报告和返回设置。没有立即启用、删除旧数据、Resume 或 Rollback 操作。

执行中注册 `beforeunload`，并通过父级路由 guard 保护侧边栏导航和浏览器后退；拒绝离开时继续停留在迁移页。刷新后的恢复仍未实现，页面不会自动 execute、resume 或 rollback。

## 数据安全证据

- 检查、预览、备份和确认阶段不会创建 IndexedDB。
- Web Locks 不可用时 `indexedDB.open` 调用数为 0。
- 完整执行前后，主 AppState、theme 和 achievements 的 localStorage 原始字符串字节级一致。
- 没有新增 `collection-revival-active-storage` key，结果中的 `activeStorageSwitched` 为 false。
- 非空目标返回 `MIGRATION_TARGET_NOT_EMPTY`，不会 clear 或覆盖原记录。
- 已占用 writer lock 时第二次执行被拒绝，不会写 Backup、metadata 或业务 Store。
- 原生 IndexedDB 写入故障会保留已验证 Backup 和 metadata，但不会显示完成，也不会启用新存储。
- 3000 条 SavedItem 与 3000 条 ImportBatchItem 的安全停止测试证明每个 Store 只能是 0 或完整数量，不存在半个 Store。

## 测试与截图

Task 7B 新增 Controller/reducer 契约、真实 IndexedDB E2E 和视觉验收测试。测试覆盖生产数据库名和版本、延迟创建、四项确认、真实 Web Locks、锁占用、目标非空、写入失败、取消、进度状态、Store 文案、移动端和 localStorage 不变。Task 1-6.1、Task 7A、MemoryAdapter、IndexedDbAdapter、Legacy Snapshot 和 Migration Preview 测试继续作为回归基线。

最终验证结果：

- `pnpm typecheck`：通过。
- `pnpm --filter @revival/storage-service test`：161 tests / 754 assertions passed。
- `pnpm check`：通过，production build 成功，Web E2E 82 passed。
- Task 7B 新增 22 个 Playwright 测试，其中 9 个 Controller/reducer 契约、8 个执行 E2E、5 个视觉验收；原有 60 个 Web E2E 未减少。
- `git diff --check`：通过。
- 本轮没有 flaky 重跑记录。

本地截图目录：

`apps/web/test-results/task7b-migration-execution/`

桌面截图：

- `desktop-1440-confirmation.png`
- `desktop-1440-progress-35.png`
- `desktop-1440-final-verification.png`
- `desktop-1440-completed-not-activated.png`
- `desktop-1440-execution-failed.png`
- `desktop-1440-cancelled.png`

手机截图：

- `mobile-390-confirmation.png`
- `mobile-390-progress.png`
- `mobile-390-completed-not-activated.png`
- `mobile-390-execution-failed.png`

截图均来自真实运行页面，未提交二进制。桌面主内容保持 960px 上限；390px 手机页面无横向滚动，确认项、进度和“尚未启用”文案完整可读。

## Task 7C 接入点

Task 7C 应在页面加载后只读检查 `migrationMetadata` 与 `backups`，为 cancelled、failed 和 completed 状态提供显式 Resume/Rollback 或报告入口。它必须继续使用 Web Locks，不得使用 test-only lock 选项，不得自动恢复，也不得切换 activeStorage。Task 8 才负责启用新存储。
