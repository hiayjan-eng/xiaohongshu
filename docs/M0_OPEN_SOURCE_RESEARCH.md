# M0 全量扫描开源调研

## 调研范围与结论

本轮只借鉴架构与实现思路，没有把任何外部项目代码复制进仓库，也没有引入新的第三方运行时依赖。所有仓库均浅克隆到项目外的 `C:\tmp\m0-full-scan-open-source-research`，扩展运行路径仍然只包含本仓库自行实现的 JavaScript。

| 仓库 | 调研提交 | 许可证 | 借鉴能力 | 明确不采用 | 具体研究文件 | 是否复制代码 |
| --- | --- | --- | --- | --- | --- | --- |
| `ONEMULE/xhs-favorites` | `4803ca65220b843196c9939943f94123c93c509c` | MIT，Copyright (c) 2026 ONEMULE | 收藏、本人笔记、专辑采用独立能力入口；持久浏览器会话；认证/风控诊断；滚动参数与 review bundle 分层 | 独立 CLI、重复登录、Cookie 流程、API/Playwright provider 直接接入 | `src/session.js`、`src/router.js`、`src/service.js`、`src/providers/playwright-provider.js`、`src/export.js`、`docs/capabilities.md` | 否 |
| `DoYitNow/xhs-cli-export` | `6c9bcbd5ef2aa815ca07f0df83fcd15dd456ed83` | MIT，Copyright (c) 2026 yuyitian | `--max 0` 无数量上限语义、JSONL 流式保存、`seen_note_ids` 增量去重、状态文件、自动重试、run 级记录 | 逆向 CLI 作为生产数据源、Cookie/认证导入、磁盘 JSONL 直接暴露给普通用户 | `src/xhs_export.py` 中 `load_state`、`save_state`、`filter_incremental_notes`、`update_incremental_state`、流式 append 与 retry loop；`README.md` | 否 |
| `lucasygu/redbook` | `1435483c64d8290dcf6e10a74be3586b8921cd66` | MIT，Copyright (c) 2026 Lucas Gu | `user-posts`、`favorites`、`boards`、`board` 的独立命令边界；完整历史分页；note URL 中 ID/token 的结构 | Cookie 提取、签名、逆向 API、CLI、收藏写操作 | `src/cli.ts` 的 `user-posts`、`favorites`、`boards`、`board` 命令；`src/lib/url.ts`；`README.md` | 否 |
| `jackwener/xiaohongshu-cli` | `4d63f3c0c85ccd9054fa8e96d7f761aaf2507449` | Apache-2.0（`pyproject.toml` 声明） | favorites 与 user-posts 分离；列表输出后建立本地 note 索引；source ID、note URL、`xsec_token` 上下文关联 | 逆向 API、Cookie 读取、反检测、CLI、点赞页或本人帖子抓取 | `xhs_cli/commands/social.py`、`xhs_cli/commands/reading.py`、`xhs_cli/note_refs.py`、`README.md` | 否 |
| `AutomaApp/automa` | `a4cbe34a60c92873c48c2470ca8ab1d96c22c7a0` | `business/` 外为 AGPL；`business/` 默认商业许可证 | 后台长任务、content/background 通信、状态持久化、停止/恢复状态、MutationObserver 触发 | 全部代码、workflow 产品模型、商业目录、远程服务、Cookie/代理等能力 | `src/workflowEngine/WorkflowState.js`、`WorkflowManager.js`、`src/background/BackgroundWorkflowUtils.js`、`src/content/elementObserver.js`、`src/db/storage.js` | 否 |

## 0.2.4 稳定基线定位

稳定基线为 `817ce19596b3ef6c2ce38ef83aa215f6cbbe1e55`。定位依据不是单看 Manifest 版本号，而是交叉核对：

1. `release-artifacts/collection-revival-extension-beta-preview-v0.2.4.zip` 的 Manifest 明确为 0.2.4 Preview。
2. ZIP 内 `src/xhs-scanner.js` 的 Git blob 为 `679bd564e95ca0e357ad334e8246a6e2be045e83`。
3. 该 blob 从 `e37f4be5e87c011ead8360377f98986ccd0be99a` 引入，并一直保持到 0.2.4 热修最终报告提交 `817ce195`。
4. `docs/P0_REAL_XHS_SCAN_HOTFIX_REPORT.md` 在 `817ce195` 记录了 0.2.4 包、收藏页识别边界、脱敏 fixture 和待用户复验标准。该提交早于后续 0.2.5 Scanner 修改。

分支 `m0-full-history-scan` 从这一提交创建，没有 merge main，也没有整包合并后续 Phase 2 分支。

## 0.2.5 可移植能力审计

后续分支中值得保留的只有数据语义，不保留回归 Scanner：

- `sourceId`：从 `/explore/`、`/discovery/item/`、query ID 提取稳定 ID。
- `canonicalSourceUrl`：统一为 `https://www.xiaohongshu.com/explore/<sourceId>`，只保留必要的 `xsec_token` / `xsec_source`。
- 规范化文本：NFC、零宽字符清理、空白折叠。
- 去重优先级：`sourceId` → canonical URL → 标题、作者、摘要 fallback hash。
- checkpoint 字段：扫描阶段、最后 ID、滚动位置、计数与更新时间。

没有移植的内容包括数量目标 10/20/50/100/200、`document.body` fallback、页面级全数组 checkpoint、固定等待和一次无增长提前结束。

## 版权声明处理

本轮没有复制外部实现，因此无需把外部许可证文本并入扩展分发包。调研文档保留了仓库、提交、许可证、版权主体和具体研究文件；如果真实 M0 后续决定复制 MIT 或 Apache-2.0 代码片段，必须在引入提交中补充对应版权与许可证声明。Automa 的 AGPL/商业代码本轮明确不复制。
