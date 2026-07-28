# P0 发布门：两项 E2E 阻断定向诊断与修复

## 范围与约束

只处理 `reward-achievement.spec.ts` 与 `task8e-independent-acceptance.spec.ts`。所有定向执行均为单 worker、零 retry、开启 trace；没有删除断言、skip、retry、固定 sleep 或单纯提高 timeout。

## 阻断 1：reward achievement

- 初始复现：失败于第二次点击 `status-completed`；详情页已显示“已复活”和“撤销完成”，但完成按钮被产品 UI 条件渲染移除。
- 判定：产品故障，不是 helper 等待不足。第一次完成、toast、首个成就、dashboard +1 均已成功，问题是幂等完成入口不再可达。
- 修复：`apps/web/src/App.tsx` 在完成态继续渲染 `status-completed`，标为“已完成，重复确认不会重复计数”；原有 `undo-completed` 仍保留。
- 奖励契约：首次完成触发 toast 与 `first_revival`；总复活数=1、周复活=1、复活值=+1；再次确认不重复累计。定向三轮均通过。

## 阻断 2：Task8E Activation 状态

- 初始独立 trace：首次失败发生在 Settings 主题动作之前。激活诊断显示 Marker 为 `indexeddb_active`、`activeBackend=indexedDB`、revision=3，数据库 `collection-revival-local` 存在，且无 recovery screen。
- 判定：`INDEXEDDB_STATUS_READINESS_RACE`。后续三次独立运行均通过；两项串行三轮也通过，未发现 suite 顺序污染或 localStorage fallback。
- 修复：`apps/web/tests/e2e/task8e-independent-acceptance.spec.ts` 在 Settings 主题写入前等待 `indexeddb-storage-status` 可见并确认 `storage-runtime-status` 为“IndexedDB 已启用”。该断言验证真实 authority，不改变产品逻辑，不接受 localStorage fallback。

## 回归证据

| 场景 | 结果 |
| --- | --- |
| reward 单项 | 3 / 3 PASS |
| Task8E 单项 | 3 / 3 PASS |
| 两项同一串行 suite | 3 / 3 PASS |
| `pnpm check:e2e-core-general` | 123 passed / 1 failed，FAIL_BLOCKING |

完整核心通用门新增失败为未授权范围内的 `legacy-settings-persistence.spec.ts`：主题按钮被定位但并行 suite 中未达到稳定可点击状态。为避免扩大 P0 变更，本轮未修改该用例或其产品行为。因此没有继续执行 Extension build、push 或 Preview。

`P0_RELEASE_GATE_STATUS: FAIL_BLOCKING`

`P0_PREVIEW_STATUS: FAIL_BLOCKING`