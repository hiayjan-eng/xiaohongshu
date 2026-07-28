# P0 Preview 发布门报告

- 分支：`p0-core-revival-loop-rescue`
- 本地 HEAD：`1b9fd17be455ebdcfface1baf697be63f2979602`
- 远程分支 SHA：`1b9fd17be455ebdcfface1baf697be63f2979602`
- 本轮结论：完整发布门未通过；没有创建 Preview。

## 本轮两项定向修复

| 阻断项 | 根因分类 | 证据与处理 | 定向回归 |
| --- | --- | --- | --- |
| `reward-achievement.spec.ts` | 产品故障 | 完成后 UI 移除了 `status-completed`，第二次幂等确认无法触达；完成态现保留同一入口，重复确认不重复计数。 | 单项 3/3 PASS；两项串行 3/3 PASS |
| `task8e-independent-acceptance.spec.ts` | `INDEXEDDB_STATUS_READINESS_RACE` | 激活后 Marker 为 `indexeddb_active`、`activeBackend=indexedDB`、revision=3，目标数据库存在；测试在 Settings 写入前新增 IndexedDB 已启用的真实就绪断言，不使用固定 sleep 或增大 timeout。 | 单项 3/3 PASS；两项串行 3/3 PASS |

两项初始独立复现均使用单 worker、零 retry、`trace=on`。reward trace 记录在 `apps/web/test-results/reward-achievement-MVP-com-653a3-ocks-first-achievement-once/trace.zip`；Task8E trace 记录在 `apps/web/test-results/task8e-independent-accepta-505cd-e-IndexedDB-the-only-writer/trace.zip`。定向回归未发现 console 或 page errors。

## 发布门结果

| 命令 | 本轮结果 |
| --- | --- |
| `pnpm check:e2e-core-general` | **FAIL_BLOCKING**：123 passed / 1 failed，212.4s |
| 后续完整门禁 | 未执行：核心通用门未通过，按发布门停止 |

失败用例为 `legacy-settings-persistence.spec.ts`（`theme-dawn` 已定位但在并行 suite 中未达到可点击稳定状态）。该项不属于本轮被授权的两项 P0 阻断，且与 reward 完成态入口、Task8E IndexedDB authority 无直接代码关联；没有通过删断言、skip、retry 或提高 timeout 处理，也没有越界修改它。

- Extension build / ZIP：未执行
- Push：未执行
- Preview：未创建
- PR / merge main / Production：均未执行
- migration / activation 的产品实现：未修改
- 真实用户数据：未读取、未接触

`P0_RELEASE_GATE_STATUS: FAIL_BLOCKING`

`P0_PREVIEW_STATUS: FAIL_BLOCKING`