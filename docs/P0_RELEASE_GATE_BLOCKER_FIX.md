# P0 发布门阻断修复记录

`CONFIRMED_ROOT_CAUSE: TEST_READINESS_RACE`

## 范围

本轮只修复 `apps/web/tests/e2e/legacy-settings-persistence.spec.ts` 的主题按钮稳定性。此前 reward achievement 与 Task8E 的修复保持不变。

## 证据与修复

原始并发失败显示 `theme-dawn` 已解析为可见、启用按钮，但 Playwright 的 actionability 检查在按钮稳定前超时。主题卡 hover / active 会产生 transform 过渡；没有发现持续遮罩、产品交互失效、Theme authority 翻转、fixture 重复种入或跨 context 存储污染。

测试改为先验证当前 `lavender-mint` 已提交、`theme-dawn` 可见且启用，再以 `click({ trial: true })` 验证真实 actionability，随后完成正式 click。保留 `dawn` 持久化、reload、AppState、achievements、Marker absent 与业务 IndexedDB absent 断言。

没有使用 force click、固定 sleep、retry、提高 timeout、skip 或断言降级；没有修改 ThemePicker 产品逻辑、migration、Prepare、Activation 或 Recovery。

## 回归结果

- 单项：5 / 5 PASS
- core-general worker 配置：3 / 3 PASS
- 与 legacy / reward / Task8E 原失败条目串行组合：3 / 3 PASS
- 发布门：typecheck、storage-runtime、storage-service、build、core-general、core-visual、core-activation、heavy、diff 全部 PASS

## 最终 Preview 状态

扩展 `0.2.3` 已构建，Vercel Preview 已 Ready，但执行环境无法连接该 Preview 完成页面级合成 smoke。为避免把部署控制面 Ready 误报为可验收，最终仍保持阻断。

`P0_RELEASE_GATE_STATUS: FAIL_BLOCKING`

`P0_PREVIEW_STATUS: FAIL_BLOCKING`