# M0 真实全量扫描发布报告

## 交付标识

- 分支：`m0-full-history-scan`
- HEAD / remote SHA：`PENDING_FINAL_COMMIT`
- Preview URL / commit：`PENDING_PREVIEW_DEPLOYMENT`
- 扩展版本：`0.3.0-m0-preview`
- 扩展加载目录：`release-artifacts/extension-m0-full-scan-preview`
- ZIP：`release-artifacts/collection-revival-extension-m0-full-scan-preview-v0.3.0.zip`
- selectorVersion：`m0-real-favorites-v3`

## 自动验证结果

| 项目 | 结果 |
| --- | --- |
| 严格收藏页识别 | PASS |
| 本人 profile 未确认阻止 | PASS |
| 隐藏本人笔记混入 | 0 |
| 风控 / 登录失效 / 网络错误安全暂停 | PASS |
| Side Panel 打开 / popup 独立 | PASS |
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
| 测试是否接触真实收藏 | 否 |
| 是否修改 Production | 否 |

## 待完成发布门

- 根级 typecheck / build / check:e2e-core-general
- 独立 Vercel Preview 创建与状态核对
- 使用实际 Preview origin 重建并验证最终扩展目录与 ZIP
- 最终 commit / push / remote SHA 核对

`M0_REAL_FULL_SCAN_STATUS: PREVIEW_DEPLOYMENT_PENDING`
