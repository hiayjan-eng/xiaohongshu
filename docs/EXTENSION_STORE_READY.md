# 浏览器扩展 Beta 与商店准备包

当前扩展已经从 POC 进入本地 Beta：它仍然是用户手动安装的 unpacked extension，不是 Chrome Web Store / Edge Add-ons 正式版。它的作用是让用户在自己已登录的小红书网页版页面里，主动点击后扫描当前已加载的收藏卡片，再把待导入清单交给 Web MVP 的 `/old-import`。

## 当前产物

运行：

```bash
pnpm --filter @revival/extension build
```

会生成两个产物：

- `release-artifacts/extension-beta`：Chrome / Edge 开发者模式下加载的已解压扩展目录。
- `release-artifacts/collection-revival-extension-beta-v0.2.2.zip`：给测试用户下载或留档的 Beta ZIP。

同时构建脚本会复制一份到：

- `apps/web/public/downloads/collection-revival-extension-beta-v0.2.2.zip`

线上 `/old-import` 可以用这个 ZIP 作为测试安装入口。

## v0.2.2 更新说明

- 扫描主按钮前置到 popup 首屏。
- 新增扫描进度条、扫描上限选择和实时数量反馈。
- “尽可能扫描全部”使用动态进度，不显示虚假的固定百分比。
- 扫描范围收紧到当前激活收藏区域中的可见卡片，减少隐藏标签或非收藏内容混入。
- 新增疑似本人发布筛选，只标记不默认删除。
- Web 端可以同步扩展里的扫描状态，返回 `/old-import` 后会自动恢复连接和同步进度。
- 增加 background 自动补注入 Web Bridge，降低 Chrome / Edge 安装或更新后反复刷新概率。
- 增加标题、作者、URL 和可见文本的清洗逻辑，减少乱码、不可见字符和脏标题。
- 结果列表限制首屏渲染数量，避免 1000 条以上结果造成 popup 卡顿。

## 已具备的 Beta 能力

- Manifest V3。
- Chrome / Edge unpacked extension 可加载。
- Popup 内可检测当前页面是否像小红书页面、是否出现登录/验证码/频繁访问等阻塞信号。
- 支持扫描当前可见卡片，也支持用户开启“自动轻滚动扫描”。
- 自动轻滚动支持暂停、继续、清空断点。
- 扫描结果会去重，用户可搜索、全选、取消选择，再确认导入。
- 导入来源标记为 `browser-extension-beta`。
- 扫描结果只包含标题、链接、封面 URL、可见短文本、作者等基础字段，不复制原帖全文、视频、评论或博主主页数据。

## 当前仍不是正式商店版的原因

- 小红书 DOM 结构不稳定，需要更多真实页面验证。
- 还没有面向 Chrome Web Store / Edge Add-ons 的正式隐私政策页面。
- 还没有商店截图、宣传图和完整审核文案。
- 需要更明确地向审核方解释：扩展只在用户主动点击后读取当前标签页可见 DOM，不做后台抓取、云端爬虫或自动登录。

## Chrome Web Store 上架前清单

- Chrome Developer Account。
- 公开隐私政策 URL。
- 商店名称、短描述、长描述。
- 权限说明：`activeTab`、`scripting`、`storage`、`downloads`。
- 128x128 图标、至少一组商店截图。
- Windows + macOS Chrome 手动测试记录。
- 确认 ZIP 内不包含源码外的本地日志、测试结果、`.env` 或临时文件。

## Edge Add-ons 上架前清单

- Microsoft Partner Center / Edge 扩展发布账号。
- 与 Chrome 相同的隐私政策和权限说明。
- Edge 特有安装、扫描、导入 smoke test。

## 推荐商店描述草稿

收藏复活旧收藏扫描 Beta 帮助用户把自己小红书网页版中已经加载出来的收藏卡片整理成待导入清单。用户需要先手动打开自己的小红书收藏页面，再点击扩展扫描。扩展不会模拟登录，不会绕过验证码，不会在后台抓取网页，也不会上传原帖完整内容；扫描结果会先展示给用户确认，再导入收藏复活 Web MVP 生成收藏索引、智能专辑和后续行动卡。

## 权限解释草稿

- `activeTab`：只在用户点击扩展时读取当前标签页中已经显示的收藏卡片。
- `scripting`：向当前标签页注入本地扫描脚本，用于读取 DOM 中可见的标题和链接。
- `storage`：保存扫描断点、Web MVP 地址和用户在 popup 中的选择状态。
- `downloads`：允许用户把扫描结果导出为 JSON，在导入前自行检查。

## 不能做的边界

不要加入自动登录、验证码绕过、后台定时爬取、云端批量抓取、公共数据收集，也不要把小红书原帖全文、评论、视频或图片复制进本产品。正式版仍然应该坚持“用户本机、用户本人页面、用户主动点击、先确认后导入”的边界。

