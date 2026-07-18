# Task 8 Implementation Plan

## Task 8A 实施结果

`TASK8A_STATUS: PASS_WITH_NON_BLOCKING_GAPS`

Task 8A 已在 `phase1-task8a-local-storage-runtime` 完成 Runtime 契约、LocalStorageRuntime、Web 异步启动门和串行持久化协调器。与最初计划相比，Web 接入被纳入本任务，以便真实验证 hydrate 前零渲染、零写入和 StrictMode 幂等；当前后端选择仍固定为 localStorage，因此没有跨越 activeStorage 切换边界。

Task 8B 下一步实现 IndexedDbRuntime、hydrate/dehydrate、数组顺序和 AppState round-trip 等价性，并复用 Task 8A 的 Runtime 与浏览器测试。Task 8B 仍不得创建 Marker、切换 activeStorage 或让普通 App 使用 IndexedDB。

## 总体门槛

Task 8 分为 8A 至 8E。每个任务独立分支、独立验收、独立 commit。8A 至 8C 均不得切换 activeStorage；8D 才实现激活协议，但仍只在隔离 Profile 验证；8E 才讨论合并和发布。任何任务失败都停止，不跨阶段顺手修产品功能。

## Task 8A：Runtime 抽象与 LocalStorage 兼容

**目标**

- 定义 ActiveStorageRuntime、RuntimeBootResult、health 层级和 Runtime 错误。
- 实现 LocalStorageRuntime，对当前主 AppState、theme 和 achievements 做兼容读写。
- 建立 booting/ready/recovery_required/boot_failed 的启动 Controller 契约。
- Marker 缺失时仍选择 legacy，但本任务不创建 Marker。

**修改范围**

- `packages/storage-service` Runtime contracts 和 LocalStorageRuntime。
- 必要的 `packages/database` 纯 normalize/codec 导出。
- 测试和架构文档。

**不修改**

- 不接 App.tsx，不创建 Bootstrap Marker，不打开 IndexedDB，不改变默认产品行为。

**测试**

- 与现有 `loadAppState` 的合法数据等价。
- 缺失 key、新用户、损坏 JSON、quota、serialize 失败。
- 不静默覆盖损坏数据。
- Runtime 写失败不返回成功。
- Marker guard 契约测试使用内存 fixture，不创建真实 marker。

**人工验收**

- 当前 App 仍走原 localStorage 链，现有 106 E2E 不减少。

**停止条件**

- LocalStorageRuntime contract 全绿；未接入产品；未创建新 key。

**工作量**：M

**允许 commit**：是，本地分支。**允许 merge/deploy**：否。

## Task 8B：IndexedDB Runtime 与 AppState 等价性

**目标**

- 实现 `hydrateAppStateFromStores`、`dehydrateAppStateToChanges` 和 id-based diff。
- 扩展 normalized Snapshot settings，保存 user、App schema 和九类数组 order manifest。
- IndexedDbRuntime 支持完整 hydrate、差异写入和多 Store transaction。
- 用固定选择器在隔离测试中比较 LocalStorageRuntime 与 IndexedDbRuntime。

**修改范围**

- storage-service Runtime、legacy snapshot mapping、runtime metadata validation。
- shared-types 仅做必要契约修正。
- 测试 fixture，不接 App 启动选择。

**不修改**

- 不创建 Bootstrap Marker，不切 activeStorage，不长期双写，不改产品页面。

**测试**

- 全部 AppState 字段和数组顺序等价。
- 记录新增、更新、删除和重排。
- 导入、专辑、ActionCard、PlanCard、纠正等跨 Store 原子性。
- 3,000/10,000 收藏 hydrate 和批量写入。
- 缺 user/order manifest 阻断，不猜默认。
- MemoryAdapter 与 IndexedDbAdapter 原 contract 无回归。

**人工验收**

- 独立测试 Profile 中 shadow read compare，只读比较，不让两边同时写。

**停止条件**

- AppState round-trip 等价；所有业务 fixture 都可恢复；仍无 active switch。

**工作量**：L

**允许 commit**：是。**允许 merge/deploy**：否。

## Task 8C：Source Drift 与 Activation Preflight

**目标**

- 实现三 key source drift 双层 checksum。
- 实现 authority Web Lock、Runtime write guard、BroadcastChannel/storage event 协议。
- 落地 Bootstrap Marker 和 Activation Journal 类型与 prepare/cancel 流程。
- 为 completed_not_activated 增加“正式启用”preflight UI，但不 commit 激活。

**修改范围**

- storage-service activation contracts/preflight。
- Web bootstrap composition 和迁移设置页确认 UI。
- migrationMetadata discriminated records；schema 仍为 v1。

**不修改**

- 不写 indexeddb_active，不写 activeStorageSwitched=true，不从 IndexedDB 启动普通 App。

**测试**

- 所有 drift 变体；QA/internal 排除；两次 checksum 竞态。
- 两标签页同时 preflight；旧标签页写入阻断。
- Marker 写后 read-back、损坏/版本错误。
- Journal prepared 与取消；失败零切换。

**人工验收**

- 两个隔离标签页模拟编辑与 preflight；页面明确保持 legacy active。

**停止条件**

- Prepare 可验证、可取消、无双写；任何漂移都阻止。

**工作量**：L

**允许 commit**：是。**允许 merge/deploy**：否。

## Task 8D：两阶段激活、异步启动与 Recovery Screen

**目标**

- App 在读取业务数据前解析 Marker。
- 实现 activation_prepared -> activating -> boot_verifying -> committed。
- 受控 reload 后 IndexedDbRuntime hydrate/health/integrity。
- commit transaction 写 Journal committed 与 `activeStorageSwitched=true`，再写最终 Marker。
- 实现启动级 Storage Recovery Screen。

**修改范围**

- `apps/web/src/main.tsx` composition root、App boot gate、Runtime state controller。
- storage-service activation coordinator。
- 设置页激活 UI、Recovery Screen 和测试。

**不修改**

- 不删除 localStorage，不提供 committed 后直接回退，不接 Supabase。

**测试**

- Marker 全状态；Journal/Marker 冲突；reload 前后崩溃。
- StrictMode 幂等；过期 boot 取消；空 state 不 persist。
- IndexedDB open/schema/hydrate/commit 失败进入 Recovery。
- committed 后 Task 7C rollback 禁止。
- 旧标签页停止写，IndexedDB 成为唯一 writer。

**人工验收**

- 仅隔离 Profile；备份、迁移、激活、连续刷新、编辑、关闭重开。

**停止条件**

- 所有中间状态可恢复；无静默 fallback；主浏览器未使用。

**工作量**：XL

**允许 commit**：是。**允许 merge/deploy**：否，需 8E。

## Task 8E：全链路验收、分支集成与发布

**目标**

- 完成性能、故障、多标签页、Preview 和测试 Profile 验收。
- 审计最终 stack diff，形成单次 main 合并和 Vercel 发布方案。
- production 发布仍默认 legacy，迁移和激活必须用户主动。

**修改范围**

- 测试、验收文档、必要的 Task 8 范围修复。

**不修改**

- 不自动迁移，不自动激活，不自动删除旧数据，不在发布任务中增加产品功能。

**测试**

- 原 106 E2E、storage-service 全套、Task 7A-C 全套。
- 3,000/10,000 数据、批量导入、搜索、计划和专辑。
- source drift、quota、versionchange、blocked、crash/reload、Marker/Journal 故障。
- Preview 部署和独立 Profile 真实浏览器演练。

**人工验收**

- Stage 0 至 Stage 2 全部通过后才请求 merge 授权。

**停止条件**

- 无 blocking/high 未处理；最终报告明确可否 merge 和 deploy。

**工作量**：XL

**允许 commit**：是。**允许 merge/deploy**：需用户新指令和验收门。

## 分支策略

```text
phase1-task8-activation-design-audit
  -> phase1-task8a-storage-runtime
    -> phase1-task8b-indexeddb-runtime
      -> phase1-task8c-activation-preflight
        -> phase1-task8d-two-phase-activation
          -> phase1-task8e-release-acceptance
```

每个子任务从上一验收通过的 HEAD 创建。开发阶段不 rebase、reset、amend 或 squash。最终只合并最末端经过验收的分支一次，避免逐个合并重复提交。

## 总停止条件

- activeStorage 切换不能与 Runtime 初次实现处于同一任务。
- 任何 source drift、Marker/Journal 冲突、无锁或 schema mismatch 都阻止激活。
- 任一阶段现有测试稳定失败，不修改不相关产品代码，状态不得标 READY。
- 合并、生产发布和用户主浏览器升级分别需要独立确认。

## Task 8B 完成门

Task 8B 已完成 IndexedDbRuntime、Runtime metadata/order manifest、hydrate/dehydrate、实体差异事务写入、引用预检、change-set read-back 和 round-trip 等价测试。schema v1 未变化，Web 未启用 IndexedDB。下一阶段 Task 8C 只能处理 activation preflight、source drift、Marker/Journal 和切换恢复，不得重新实现 Runtime 数据读写。
## Task 8C 完成记录

Task 8C 已实现 Source Drift、目标完整等价预检、Web Locks writer lock、Runtime write gate、多标签页通知、Bootstrap Marker、Activation Journal、Prepare/Cancel 和启动只读识别。验收状态为 `PASS_WITH_NON_BLOCKING_GAPS`，详见 `TASK8C_ACCEPTANCE.md`。当前 backend 仍为 localStorage；Task 8D 仅可从一致的 activation_prepared 证据继续，负责真正两阶段切换、controlled reload、正式 IndexedDB boot 与完整 Recovery Screen。Task 8E 才负责集成和发布验收。
## Task 8D 完成记录

Task 8D 已实现正式确认、final recheck、switching/activating、controlled reload、严格 Runtime selector、IndexedDB activation boot、原子 commit、跨标签页冻结、Recovery Screen 与 Storage Status。验收状态为 `PASS_WITH_NON_BLOCKING_GAPS`；核心安全路径完整，更多真实浏览器故障注入、物理浏览器 10,000 条性能记录和全部瞬时阶段截图留给 Task 8E。当前未合并、未发布、未操作真实用户数据，Task 8E 负责隔离 Profile 全链路验收、最终审计和发布决策。
