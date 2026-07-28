# P0 Preview 发布门报告

- 分支：`p0-core-revival-loop-rescue`
- 本地 HEAD：`50863362d4861823c34e384b0c86764e5c1e61db`
- 远程分支 SHA：`50863362d4861823c34e384b0c86764e5c1e61db`
- Preview deployment：`dpl_EVMWtA4UczrWGJCYuhzUkngRaP5Y`
- Preview URL：`https://xiaohongshu-4fyatlvv9-ayj.vercel.app`
- 分支别名：`https://xiaohongshu-git-p0-core-revival-loop-rescue-ayj.vercel.app`
- Vercel target / state：Preview / Ready

## legacy settings 最后阻断

`CONFIRMED_ROOT_CAUSE: TEST_READINESS_RACE`

原始失败中，`theme-dawn` 已被定位、可见且启用，但 Playwright 在完整并发 suite 下等待稳定可点击状态超时。独立、同 worker 配置与完整 suite 复现均未重现持续性产品不可交互、遮挡、fixture authority 冲突或 suite state 泄漏；主题卡进入 hover/active 状态时会经历 transform 过渡，因而根因为点击在 Settings/ThemePicker 交互就绪点之前触发的低概率 actionability 竞态。

修改仅在 `apps/web/tests/e2e/legacy-settings-persistence.spec.ts`：保留主题 authority、AppState、achievements、reload、Marker absent、IndexedDB absent 的所有原有断言；新增当前主题已提交、目标按钮 visible/enabled，以及 Playwright `trial` actionability 验证，随后执行正式 click。没有 force click、固定 sleep、retry、提高 timeout 或产品逻辑修改。

## 定向回归

| 场景 | 结果 |
| --- | --- |
| legacy spec，单 worker、零 retry、trace on | 5 / 5 PASS（每轮 3 tests） |
| legacy spec，`--workers=6`、零 retry、trace on | 3 / 3 PASS（单文件按 Playwright 文件模型串行） |
| legacy + reward + Task8E 原失败条目，串行、零 retry、trace on | 3 / 3 PASS（每轮 5 tests） |

组合回归同时确认 `lavender-mint → dawn → reload → dawn`、AppState 与 achievements 未覆盖、Marker absent、业务 IndexedDB absent，以及 reward / Task8E 既有契约。

## 完整发布门

| 命令 | 结果 |
| --- | --- |
| `pnpm typecheck` | PASS（扩展 0.2.3 更新后再次通过） |
| `pnpm --filter @revival/storage-runtime test` | PASS（70 tests / 295 assertions） |
| `pnpm --filter @revival/storage-service test` | PASS（181 tests / 826 assertions） |
| `pnpm build` | PASS |
| `pnpm check:e2e-core-general` | PASS（124 / 124） |
| `pnpm check:e2e-core-visual` | PASS（12 / 12） |
| `pnpm check:e2e-core-activation` | PASS（8 / 8） |
| `pnpm check:e2e-heavy` | PASS（3 / 3） |
| `git diff --check` | PASS |

项目未定义 `check:e2e-core-storage`；以上现有 core general / visual / activation 三段共同维持项目真实的核心 E2E 覆盖，没有替换或删减脚本。

## Extension

- Manifest version：`0.2.3`
- 可加载目录：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\extension-beta`
- 版本化 ZIP：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\collection-revival-extension-beta-v0.2.3.zip`
- 扩展校验：PASS；未复用旧 `0.2.2` 构建。

## Preview Smoke

Vercel 控制面确认上述 Preview 为 Ready；但本执行环境无法建立到 `*.vercel.app:443` 的连接。`vercel curl` 已生成部署保护绕过令牌后仍在 TLS 连接阶段超时；直接 HTTPS 头请求同样超时；远程浏览器访问被安全策略拒绝。因此无法用合成数据完成 `/`、`/old-import`、`/import`、`/albums`、`/today`、`/settings` 的页面级 smoke，也不能诚实地标记为用户可复验。

- PR：未创建
- merge main：未执行
- Promote / Production：未执行
- migration / activation 产品实现：未修改
- 真实用户数据：未读取、未接触

`P0_RELEASE_GATE_STATUS: FAIL_BLOCKING`

`P0_PREVIEW_STATUS: FAIL_BLOCKING`
## 0.2.4 扩展现场热修

本次只交付扩展 Preview 测试包，不修改 Web 业务实现。包版本为 `0.2.4`，目录为 `release-artifacts/extension-beta-preview`，ZIP 为 `release-artifacts/collection-revival-extension-beta-preview-v0.2.4.zip`。包内默认导入目标是分支 Preview 别名的 `/old-import`，并且只加入精确 Preview origin；生产源包仍为 `0.2.3`，默认导入目标不变。

扩展 DOM fixture、Preview packaging profile 和 production profile 均已通过。下一步只等待该 P0 分支的 Preview 别名指向本次提交，再由用户用同一真实收藏页完成复验；不会创建 PR、合并 main、Promote 或部署 Production。