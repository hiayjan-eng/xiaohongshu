# 真实数据迁移前检查

日期：2026-07-28  
Production URL：`https://xiaohongshu-green.vercel.app`  
当前分支 / HEAD：`phase3-real-data-migration-precheck` / `d962e0ec2b06dba49e0ca2c69251cbb98048e8e1`

## 范围与安全边界

- `DEEPSEEK_LIVE_TEST: DEFERRED`。未继续真实 API 联调，未调用 DeepSeek 或其他外部 API。
- 原 Worker 分支 `feat/deepseek-dev-worker-mvp` 已保留；未修改、合并、推送或删除。
- 本轮未打开或自动接管用户主浏览器 Profile，未访问生产站，也未读取、记录或上传真实收藏标题、正文、URL、个人信息、Cookie、token 或 API Key。
- 本轮未执行真实 migration、Prepare、Activation、Rollback；未修改 production Runtime、extension、Marker、Journal、localStorage 或 IndexedDB；未 push、merge 或 deploy。

## 离线代码审计

审计范围：migration preview、backup download、checksum、legacy parser、schema validator、source drift、target verification、activation prepare 与 recovery guard。

结论：

- `MigrationFlowController.inspect()` 仅通过只读的 `getItem` / `key` / `length` 边界读取允许的 localStorage key，生成备份 envelope、校验结果和迁移计划；`createMigrationPreview()` 只构建报告/计划，读取目标时也仅依赖 `getAll`。
- 备份下载只将当前检查结果序列化为浏览器本地 JSON Blob；不会修改 authority、Marker 或 Journal。
- 迁移页面加载时会自动以 `indexedDB.databases()` 检查既有迁移会话；该操作不打开或创建数据库，也不会迁移、继续迁移、回滚或激活。
- 真实写入仅位于独立的 `startExecution()`、Prepare、Activation、Resume 和 Rollback 显式操作路径中。本轮不会触发这些路径。
- 静态类型检查通过：`@revival/storage-service`、`@revival/web`。

## 真实数据检查结果

以下项目必须由用户手动打开正式网址后，通过只读“检查/预览”和产品自带备份下载补全；本报告不包含真实内容。

| 项目 | 结果 |
| --- | --- |
| 真实数据所在浏览器与域名 | 待用户手动确认；域名限定为 `https://xiaohongshu-green.vercel.app` |
| 当前 Runtime / authority | 待检查 |
| Bootstrap Marker | 待检查 |
| business IndexedDB | 待检查 |
| SavedItem / album / plan / achievement / theme / user settings | 待检查（仅记录数量和状态） |
| 数据体积、schema、无效记录、重复记录、容量风险 | 待检查（仅记录统计） |
| 产品备份 | 备份目录已就绪：`C:\Users\86178\Documents\小红书收藏夹_真实数据备份`；尚未下载 |
| 备份 JSON 解析、checksum、SavedItem 数量核对 | 待备份下载后验证 |
| Preview | 待用户手动运行只读“检查/预览” |
| source / projected target / skipped / warning / error | 待 Preview 结果 |
| source drift / duplicate primary ID / checksum mismatch | 待 Preview 结果 |
| Recovery 路径 | 代码路径存在；生产状态待检查 |

## 判定

```text
REAL_DATA_MIGRATION_PRECHECK_STATUS: NO_GO
```

原因：尚未完成用户手动的只读生产检查、完整备份下载、备份解析与 checksum 核验，以及 Preview 统计核对。因此不能确认 legacy localStorage 仍为 authority、Marker absent、IndexedDB 非 authority、数据无阻塞错误或不存在 source drift。

下一步只能是：`修复迁移前检查 Blocking`。
