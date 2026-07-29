# P0 行动执行闭环修复报告

- 分支：`p0-core-revival-loop-rescue`
- 代码验证基准：`a10f49bd75867726ceb23c11b744485d4bbb7399`
- 范围：用途绑定、加入今日、产品内计划弹窗、行动状态机、产出与完成持久化

## 根因与修复

1. 用途此前只影响备注，分类模板仍决定行动卡内容。现在八种用途先映射为稳定 `ActionIntentKey`，可执行用途使用独立模板生成目标、步骤、产出和完成标准，并写入 `generatedFromIntent`、`templateVersion`。其中“学会这个方法”固定产出一张测试图文和一份 3–5 步操作清单，不再生成内容选题；“只是整理留存”会移除该收藏的行动卡和计划，只保留索引。
2. “加入今日”此前只改状态，没有创建权威 PlanCard。现在统一走计划 upsert，使用本地今天，重复操作不会新增记录，成功提示为“已加入今天，可以现在开始”，刷新后仍保留。
3. 行动计划流程已改为产品内弹窗，支持今天、明天、自选日期，10/20/30/60 分钟和可选备注；修改计划复用原 PlanCard ID。弹窗支持 Escape、焦点锁定和移动端不溢出，本流程不调用浏览器原生 prompt、alert 或 confirm。
4. 详情页只保留一个行动主操作区，状态限定为 `not_started → scheduled_today/scheduled → in_progress → completed`，并支持 `snoozed` 与撤销完成。详情 URL 携带收藏 ID，刷新后不会跳到其他收藏。
5. 产出、保存时间、实际用时、计划完成状态与收藏完成状态一起持久化。空产出使用产品内确认；首次完成与计划完成成就一次性合并写入，避免后者覆盖“第一次复活”提示，重复完成不增加统计。

## 自动化覆盖

新增 `action-execution-loop.spec.ts`，覆盖七种可执行用途的差异化卡片、整理留存、今日幂等、刷新、计划修改不重复、自选日期与时长、移动端、Escape、无原生弹窗、空产出确认、完成与产出持久化。既有分类、主题、奖励、产品核心和 Task8E 测试同步适配新的状态机，没有新增 skip、retry、force click、固定 sleep 或放宽超时。

| 发布门 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `pnpm check:e2e-core-general` | PASS，126 / 126 |
| `git diff --check` | PASS |

未修改 Extension 0.2.4、IndexedDB schema、迁移/Prepare/Activation/Recovery、DeepSeek Worker、智能专辑算法、main 或 Production；storage service 未改动，因此未触发额外 storage service 测试要求。

`P0_ACTION_EXECUTION_STATUS: READY_FOR_USER_RETEST`