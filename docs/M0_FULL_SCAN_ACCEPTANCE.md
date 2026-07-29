# M0 Full Scan 技术 Spike 验收

## 基线与范围

- 分支：`m0-full-history-scan`
- 0.2.4 稳定基线：`817ce19596b3ef6c2ce38ef83aa215f6cbbe1e55`
- 真实用户数据：未接触
- Production：未修改、未部署
- Web 分类、专辑、搜索、行动卡、导入：未修改

## 夹具能力

`apps/extension/tests/fixtures/full-scan-virtual-list.html` 支持 20、100、500、1000、3000、5000 条配置，并模拟：

- 收藏面板无限滚动；
- 虚拟列表 DOM 回收；
- 延迟加载；
- 每 7 轮一次偶发空轮；
- 重复卡片渲染；
- 页面刷新与 runtime 重建；
- 隐藏本人笔记面板；
- 收藏与本人笔记使用相同 card DOM；
- 风控、登录过期、网络错误遮挡。

## 验收命令

```text
pnpm --filter @revival/extension typecheck
node apps/extension/scripts/run-full-scan-spike.mjs
```

由于系统优先命中的 WinGet `pnpm.exe` 在沙箱内无执行权限，实际静态校验使用 Codex bundled pnpm fallback 运行；命令内容与 package script 不变。

## 3000 条结果

2026-07-30 本地 Chromium 合成测试结果：

| 指标 | 结果 |
| --- | ---: |
| fixture 总数 | 3000 |
| 发现数 | 3000 |
| 有效数 | 3000 |
| 本人笔记混入 | 0 |
| 重复新增 | 0 |
| 中断 checkpoint | 1200 |
| 页面刷新/runtime 重建后最终数 | 3000 |
| 最终唯一 sourceId | 3000 |
| 最终去重核验 | PASS |
| 完成时稳定无增长周期 | 6 |
| 当前页面滚动请求 | 41 |
| 虚拟列表 DOM 峰值 | 61 张卡片 |
| 内容脚本缓冲峰值 | 61 条候选；单次 IDB 批次仍为 25 |
| Side Panel recent 峰值 | 12 |
| 浏览器堆增量 | 1.56 MiB |
| 整轮运行时间 | 4967 ms |

中断发生在 1200 条。测试随后刷新页面，使 content runtime 和测试中的后台适配器同时重建，再以同一 ScanSession 恢复；IndexedDB 内的 1200 条和 checkpoint 没有丢失，最终达到 3000。

## 边界结果

- 风控遮挡：开始前拒绝，code `RISK_CONTROL`。
- 登录过期：开始前拒绝，code `LOGIN_EXPIRED`。
- 网络错误：开始前拒绝，code `NETWORK_ERROR`。
- 本人笔记面板：50 张与收藏完全同构的 card 全部位于 own-post panel，导入数为 0。
- `document.body`：全量核心静态检查确认不存在 fallback。
- 5000 条：夹具能力与严格页面身份检查通过；本轮硬门只要求 3000 条完整运行。

## 结论

Side Panel、收藏面板自动滚动、MutationObserver 流式采集、Extension IndexedDB checkpoint、虚拟列表与刷新恢复的技术可行性均已通过，可以进入真实 M0 全量扫描实现。这个结论不等于真实账号 3000 条验收完成；真实验收前产品级 `M0_STATUS` 仍为 `FAIL_BLOCKING`。

`M0_FULL_SCAN_SPIKE_STATUS: PASS`

下一步只能是：进入真实 M0 全量扫描实现。
