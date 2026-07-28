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
## 0.2.4 现场扫描热修复验

本轮请不要加载旧的 0.2.3 候选包。先在 Chrome 扩展管理页移除或停用旧测试包，再“加载已解压的扩展程序”：

- 目录：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\extension-beta-preview`
- ZIP（如需转交）：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\collection-revival-extension-beta-preview-v0.2.4.zip`

打开扩展后，页头应写“Preview 测试包 0.2.4”。进入同一真实小红书个人收藏页，保持“收藏”标签激活并让卡片可见。选择 10 或 20 后点击“开始扫描旧收藏”：按钮应立即进入加载状态，进度先显示“正在检查当前收藏页…”。

如果卡片被识别，进度上限只能显示 10 或 20，不能出现 `0/200`。如果暂时识别为零，页面仍应显示“已确认收藏页”，并给出提取根、链接和 data-note 计数；可用“复制脱敏诊断”回传，不要复制或发送真实收藏标题、作者、链接或 ID。

点击导入时，0.2.4 Preview 测试包默认只会打开：`https://xiaohongshu-git-p0-core-revival-loop-rescue-ayj.vercel.app/old-import`。