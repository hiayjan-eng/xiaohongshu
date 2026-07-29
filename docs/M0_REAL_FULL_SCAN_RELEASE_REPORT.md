# M0 真实全量扫描发布报告

## 交付标识

- 分支：`m0-full-history-scan`
- 实现与 Preview commit：`f7d53f6f8d920e217efaf5f01a49a522b908108a`
- Preview URL：`https://xiaohongshu-onbi21ron-ayj.vercel.app/m0-preview/`
- Vercel deployment：`dpl_HhJS9jvHmYJRa7w4skcgWmTRKzPV`，状态 `READY`，target 为 Preview
- 扩展版本：`0.3.0-m0-preview`
- 扩展加载目录：`release-artifacts/extension-m0-full-scan-preview`
- ZIP：`release-artifacts/collection-revival-extension-m0-full-scan-preview-v0.3.0.zip`（49,513 bytes）
- selectorVersion：`m0-real-favorites-v3`

## 自动验证结果

| 项目 | 结果 |
| --- | --- |
| 严格收藏页识别 | PASS |
| 本人 profile 未确认阻止 | PASS |
| 隐藏本人笔记混入 | 0 |
| 风控 / 登录失效 / 网络错误安全暂停 | PASS |
| Side Panel 打开 / popup 独立 | PASS |
| 自动滚动 / MutationObserver / loading 自适应 | PASS |
| 20 / 100 / 500 / 1000 fixture | 精确等于目标数 |
| 3000 fixture | 3000 |
| 5000 fixture | 5000 |
| 1200 中断恢复 | 3000 / 5000 最终一致 |
| 虚拟列表 DOM 峰值 | 61 |
| Side Panel recent 峰值 | 12 |
| 第二次完整扫描新增 | 0 |
| Preview 首次 / 二次导入 | 20 / 0（脱敏 fixture） |
| importBatchId 撤销隔离 | PASS |
| 原帖 URL 优先级与 profile 拒绝 | PASS |
| Preview namespace 隔离 | PASS |
| Production sentinel | 未变化 |
| 最终扩展精确 Preview origin 校验 | PASS |
| Vercel Preview `/m0-preview/` | HTTP 200 |
| `pnpm typecheck` | PASS |
| `pnpm build` | PASS |
| `pnpm check:e2e-core-general` | 最终完整重跑 124 / 124 PASS |
| `git diff --check` | PASS |
| 测试是否接触真实收藏 | 否 |
| 是否修改 Production | 否 |

`check:e2e-core-general` 首轮为 123 / 124，一条既有 Task8E 用例在点击时遇到瞬时 React 节点脱离；未使用 retry、skip、force click 或配置放宽。该用例单独复现通过，随后完整套件干净重跑为 124 / 124 PASS。

真实 3000+ 收藏仍须由用户按 `docs/M0_REAL_FULL_SCAN_USER_GUIDE.md` 亲自验收；在此之前不 merge main、不创建 PR、不 Promote、不部署 Production。

`M0_REAL_FULL_SCAN_STATUS: READY_FOR_USER_VALIDATION`