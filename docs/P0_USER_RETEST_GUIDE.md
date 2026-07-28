# P0 Preview 用户复验指南

当前 Vercel Preview 已创建，但自动 Smoke 因执行环境无法连接 Preview 域名而未完成。请在可访问该地址的浏览器中完成以下合成数据复验后，再将结果反馈给开发。

- Preview：`https://xiaohongshu-4fyatlvv9-ayj.vercel.app`
- 分支别名：`https://xiaohongshu-git-p0-core-revival-loop-rescue-ayj.vercel.app`
- 对应提交：`50863362d4861823c34e384b0c86764e5c1e61db`

## 页面检查

依次打开 `/`、`/old-import`、`/import`、`/albums`、`/today`、`/settings`。每页应正常显示，没有空白页、恢复页或 console error。

## 核心闭环

使用合成收藏导入一条内容，确认分享模板不会污染分类；将该收藏复活，检查 ActionCard 内容具体可执行；完成一次后应出现首次复活反馈，刷新后统计与成就仍正确，再次完成不重复累计。

在 Settings 选择 `lavender-mint` 后切换到 `dawn` 并刷新，仍应为 `dawn`；既有收藏与成就不应被覆盖，且默认 legacy 路径不应创建 Bootstrap Marker 或业务 IndexedDB。

## Extension

加载目录：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\extension-beta`

ZIP：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\collection-revival-extension-beta-v0.2.3.zip`

确认 Manifest 版本为 `0.2.3`，扫描入口只针对当前已加载的小红书收藏卡片，且收藏入口不会打开失效 profile URL。

## 当前状态

`P0_RELEASE_GATE_STATUS: FAIL_BLOCKING`

`P0_PREVIEW_STATUS: FAIL_BLOCKING`

阻断原因仅为自动 Preview Smoke 的网络可达性无法在本执行环境确认；未执行 Production 操作，也未读取真实用户数据。