# Phase 1 Release And Recovery Plan

## 1. 发布原则

正式发布代码与用户主动启用是两个事件。production 可以包含迁移和激活能力，但默认仍使用 legacy localStorage；任何用户都必须主动检查、下载备份、迁移、复核漂移并确认激活。发布不得自动创建 IndexedDB、自动迁移或自动写 Bootstrap Marker。

## 2. Stage 0：本地自动化与隔离浏览器

范围：fake-indexeddb、MemoryAdapter、全新 Playwright context 和虚构数据。

验收：

- 3,000 与 10,000 SavedItem round-trip；
- 全部实体、用户设置和顺序等价；
- source drift、两次 checksum 和无漂移；
- 多标签页 authority lock；
- reload/crash、quota、transaction abort、versionchange、blocked；
- Marker/Journal 每个中间状态；
- Recovery Screen 和安全报告；
- 原 106 Web E2E、storage-service 与扩展回归不减少。

停止：任何数据丢失、双写、静默 fallback 或不可恢复中间态。

回退：只回退 Task 8 分支代码，测试数据库使用独立名称并清理；不触碰真实 Profile。

## 3. Stage 1：Vercel Preview

从最终 Task 8E 分支创建 Preview deployment，不合并 main。使用独立浏览器 Profile 和虚构/导入的测试数据，不使用用户主浏览器。

验收：

- SPA 路由和生产 build；
- backup download、migrate、cancel/resume/rollback；
- source drift 阻止；
- activation prepare、reload、IndexedDB boot、commit；
- 新增/编辑/删除后只写 IndexedDB；
- localStorage 保持只读；
- 两标签页切换与 stale page 阻断；
- 连续关闭重开至少五次。

停止：Preview 与本地行为不一致、console error、浏览器能力缺失未安全阻止。

回退：删除 Preview deployment 或停止使用 URL，不修改 production。

## 4. Stage 2：用户自己的测试 Profile

使用新的 Chrome/Edge Profile。先导出旧 Backup，再把虚构或脱敏测试数据导入该 Profile，完整演练扫描后的 Web 数据流程。不得让扩展读取或改变用户主 Profile 的数据。

验收：

- 真实浏览器 Web Locks、Web Crypto、IndexedDB 和下载；
- 迁移后故意修改 legacy，确认 drift 阻止；
- rollback 后重新迁移；
- 激活后新增收藏、改备注、分类、专辑、行动卡和计划；
- DevTools 检查主 AppState 字节不变、业务写只进入 IndexedDB；
- Recovery Screen 可导出报告和两个后端快照。

停止：任何需要手工改 DevTools 数据才能继续、任何旧标签页可继续写、任何报告泄露用户正文。

回退：删除测试 Profile；不触碰主浏览器。

## 5. Stage 3：合并 main

只合并最末端、包含完整 stack 且通过验收的 Task 8E 分支一次。不要依次合并 Task 6、6.1、7A、7B、7C、8A-D，因为这些提交已经是祖先，逐个合并会增加冲突和误操作。

合并前：

1. 确认 `git merge-base --is-ancestor` 覆盖每个阶段验收 HEAD。
2. 输出 `main..final-branch` diff stat、name-status、lockfile 和运行依赖审计。
3. 重跑 typecheck、storage-service、production build、全部 E2E 和 `git diff --check`。
4. 检查默认路径不创建 marker、不迁移、不激活。
5. 请求用户明确授权 merge。

策略建议：使用一次普通 merge commit，保留阶段提交和可审计历史。开发期间明确禁止 squash/rebase；最终也不建议 squash，因为当前 stack 包含多个独立数据安全验收点。若用户未来明确要求 squash，必须先保存 tag/branch 和完整 commit map，本审计不授权。

GitHub Desktop 最安全操作：切换 main、Fetch origin、确认 clean、选择最终 Task 8E 分支执行一次 merge、解决冲突后在本地重跑全套测试，再 push main。不要对中间分支重复执行 merge。

## 6. Stage 4：Production 发布但不自动启用

Vercel production 绑定 main。发布前记录 commit、deployment id、local/production bundle；发布后使用干净 Profile smoke。

必须保持：

- Marker 缺失用户继续 LocalStorageRuntime；
- 不自动读取迁移入口之外的 legacy backup；
- 不自动创建 production IndexedDB；
- 不自动迁移或激活；
- Task 7/8 入口由用户主动开始；
- 扩展扫描、Bridge 和导入协议不变。

停止：普通用户首次打开即出现迁移、数据库创建、Recovery Screen 或旧流程行为变化。

代码回退：使用 Vercel rollback 或 revert 发布 commit，不执行破坏性 Git 操作。已经激活的用户数据不能靠前端代码回退自动恢复旧 writer；旧版本若不理解 Marker，可能造成 split-brain，因此 production 回滚前必须有兼容启动策略或暂时阻止已激活 Profile 写入。

## 7. Stage 5：用户主浏览器手动升级

前置：Stage 0-4 全部 PASS，用户明确选择，备份文件已下载并在浏览器列表确认。

流程：检查 -> Preview -> Backup -> Migration -> Verify -> source drift check -> activation prepare -> reload -> IndexedDB boot -> commit -> 连续验证。

激活后至少验证：

- 收藏、批次、专辑、行动卡、计划卡和纠正数量；
- 用户备注、标题、分类和状态；
- 搜索、导入、编辑、撤销；
- theme 和 achievements；
- 连续刷新和关闭重开；
- 旧 localStorage 未删除且不再写；
- Backup、Metadata、Journal 保留。

任何异常进入 Recovery Screen，不手工清数据，不运行 Task 7C rollback。

## 8. 旧 localStorage 保留

Phase 1 永久保留到未来独立清理阶段：

- 主 AppState、theme 和 achievements在 committed 后只读；
- developerMode、QA/RealTest 按内部边界继续独立，不属于业务 fallback；
- 不提供自动清理或立即清空按钮；
- Bootstrap Marker、Backup、MigrationMetadata 和 Journal 不得由清理功能删除。

未来清理至少要求用户导出 Backup、IndexedDB 多次健康启动、明确确认和独立恢复设计。

## 9. 失败恢复分类

| 阶段 | 可用恢复 |
|---|---|
| 迁移前/预览 | 不写入，重新检查 |
| 迁移中且未 activation | Task 7C Resume 或 Rollback |
| activation prepared 且未 commit | 继续激活或显式取消 prepared |
| activating/boot verifying | Recovery Screen 重试；不进入旧可写 App |
| committed | 重试 IndexedDB；未来反向迁移，不允许 Task 7C rollback |
| production 代码回退 | revert/rollback deployment，但必须保持 Marker 兼容和已激活用户写保护 |

## 10. 发布报告

最终报告必须区分：代码发布、默认 Runtime、用户是否迁移、用户是否激活、active backend、旧数据保留、Backup/Journal 状态、测试 Profile 与主浏览器。不得把“激活 UI 已上线”描述成“用户数据已切换”。
## Task 8C 发布与恢复门

Task 8C 分支不可合并或部署。Prepare 后 Marker/Journal 只是“已准备，尚未切换”，`activeStorageSwitched=false`，原 localStorage 不删除。Prepare 可在一致证据下取消，保留 Backup、MigrationMetadata、Journal 和目标数据；Marker/Journal 冲突或中间失败进入 recovery_required 并冻结普通写入。Task 8D 完成真实激活和 Recovery，Task 8E 通过隔离 Profile 全链路验收后才能讨论 main 集成与 production。
## Task 8D 发布前恢复门

正式激活后，`activeStorageSwitched=true`、Journal committed 和 Marker active 共同确定 IndexedDB authority。Task 7C rollback 永久阻断，Recovery 只允许重试 IndexedDB、补完已提交 Marker和导出证据；不允许直接返回可写 localStorage。旧 localStorage 三个产品 key继续保留，但仅作只读历史。Task 8E 必须在隔离 Profile 验证完整激活、连续刷新、CRUD、跨标签页和故障恢复后，才可请求 main 合并或部署授权；Task 8D 本身没有发布权限。
