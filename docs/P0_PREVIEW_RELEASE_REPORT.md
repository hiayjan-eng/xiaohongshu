# P0 Preview 发布门报告

- 分支：`p0-core-revival-loop-rescue`
- 本地 HEAD：`8e212abc23c802bcecd3209b2485a40c9a6d5981`
- 远程分支 SHA：`8e212abc23c802bcecd3209b2485a40c9a6d5981`
- 远程状态：远程已指向当前 HEAD；未重复 push。

## pnpm check 拆分结果

| 原始顺序 | 命令 | 结果 | 耗时 / 数量 |
| --- | --- | --- | --- |
| 1 | `pnpm typecheck` | PASS | 58 秒 |
| 2 | `pnpm --filter @revival/storage-runtime test` | PASS | 34.9 秒；70 tests / 295 assertions |
| 3 | `pnpm --filter @revival/storage-service test` | PASS | 9.3 秒；181 tests / 826 assertions |
| 4 | `pnpm build` | PASS | 16.7 秒 |
| 5 | `pnpm check:e2e-core-general` | FAIL_BLOCKING | 234.5 秒；122 passed、2 failed |

先前两次 `pnpm check` 超时的原因已确认：它串行执行完整 E2E，而 `check:e2e-core-general` 本身耗时约 3 分 55 秒，超过之前 2 分钟窗口，并挤占 5 分钟窗口中的后续检查时间。此次不是把超时当成通过，而是按原顺序拆分后获得了明确失败。

## 阻断项

1. `reward-achievement.spec.ts` 在 `status-completed` 点击时超时，说明 P0 完成动作入口与既有奖励验收路径不兼容。
2. `task8e-independent-acceptance.spec.ts` 在 IndexedDB 激活后找不到 `indexeddb-storage-status`。该项属于本轮冻结的 Activation / IndexedDB 范围，未做修改。

根据发布清单，发现真实失败后立即停止，不创建 Preview，不生成新的扩展测试包，不进行新的 push，也不触及 Production。

- Web build：PASS（本地）
- Extension build：未执行，因发布门未通过
- Extension 测试目录 / ZIP：未生成新的同提交包
- Preview deployment ID / URL：未创建
- Preview Smoke：未执行
- Preview origin 安全配置：未修改
- Production：未修改
- 真实用户数据：未读取、未接触

`P0_RELEASE_GATE_STATUS: FAIL_BLOCKING`

`P0_PREVIEW_STATUS: FAIL_BLOCKING`