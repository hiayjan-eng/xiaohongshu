# 手机 App 路线图

当前项目仍然是 Web MVP，`apps/mobile` 只是移动端结构和分享入口的原型预留。第二阶段先统一导入管线和数据模型，再进入完整 App 开发会更稳。

## 未来 App 目标

- iOS / Android 双端。
- 手机系统分享入口：在小红书里点击分享，选择“收藏复活”。
- 今日复活：每天只推 1-3 条行动卡。
- 搜索找回：按地点、技能、店名、菜名、工具名找回原帖。
- 行动卡：查看下一步行动、任务、状态和原帖链接。
- 计划库：学习、旅行、做饭、效率等计划。
- 智能专辑：旧收藏扫描或批量导入后先按主题整理。
- 小组件：后续把今日行动放到手机桌面。

## 为什么现在不直接做完整 App

现在最重要的问题不是 UI 壳，而是所有入口的数据是否统一：手动导入、扩展扫描、批量链接、未来手机分享入口都应该进入同一套 ImportBatch 管线。如果先做 App，容易出现 Web 一套导入逻辑、App 一套导入逻辑、扩展又一套导入逻辑，后面接真实 AI 和云同步时会很难维护。

完整 App 还需要账号、云数据、真实 AI 服务、隐私设置、错误恢复和多端状态同步。当前 localStorage 阶段适合验证产品闭环，不适合作为移动端正式数据底座。

## 推荐技术路线

- Expo / React Native。
- 继续复用 monorepo 下的共享 packages：`shared-types`、`import-service`、`ai-service`、`search-service`、`action-card-service`、`storage-service`。
- iOS 后续做 Share Extension。
- Android 后续做 Share Intent。
- Web、App、Extension 共用 ImportBatch / SavedItem / ActionCard / SmartAlbum 数据结构。

## App 第一版最小功能

- 登录：后续接云同步时加入。
- 接收分享链接：把系统分享 payload 转成 ImportBatchItem。
- 自动生成行动卡：复用 import-service 和 ai-service。
- 今日复活：复用 recommendation-service。
- 搜索找回：复用 search-service。
- 查看智能专辑：复用 SmartAlbum 数据结构。

## App 与 Web 共享数据结构

App 第一版应直接复用：

- `ImportBatch`
- `ImportBatchItem`
- `SavedItem`
- `ActionCard`
- `Task`
- `SmartAlbum`
- `Plan`
- `SearchLog`

这样 App 不是另一个产品，而是收藏复活在手机端的低摩擦入口。