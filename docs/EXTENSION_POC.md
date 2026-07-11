# 旧收藏夹扫描 / 智能专辑整理 POC

本轮目标不是做云端爬虫，也不是批量抓取平台内容，而是验证一个本机浏览器扩展路径：用户自己登录小红书网页版，手动打开自己的收藏夹页面，主动点击扩展按钮后，扩展读取当前页面已经加载到 DOM 里的收藏卡片基础信息，再交给收藏复活 Web MVP 本地导入。

## 当前实现范围

新增目录：`apps/extension`

扩展能力：

- Manifest V3
- Chrome / Microsoft Edge 可加载的 unpacked extension 结构
- popup 作为 POC 操作面板
- 用户点击后通过 `chrome.scripting.executeScript` 临时注入 content script
- 扫描当前页面中已加载的小红书笔记链接和附近卡片 DOM
- 提取：`title`、`sourceUrl`、`coverUrl`、`visibleText`、`sourcePlatform`
- popup 展示扫描结果列表
- 支持导出 JSON
- 支持打开 Web MVP，并通过 `#extension-import=...` 传递扫描清单

Web MVP 新增能力：

- 接收浏览器扩展 payload
- 转换成现有 `ShareInput`
- 复用 mock AI 分类和行动卡生成逻辑
- 复用 localStorage/mock database 保存 `SavedItem` 和 `ActionCard`
- 生成 `SmartAlbum` 智能专辑候选
- 新增“专辑”页面展示候选专辑，每个专辑只推荐 3 条优先复活
- 支持专辑候选改名和删除，删除候选不会删除收藏本身

## 官方技术依据

- Chrome Extensions content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome Extensions scripting API: https://developer.chrome.com/docs/extensions/reference/api/scripting
- Chrome Extensions activeTab permission: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- Microsoft Edge extensions overview: https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/

这些能力适合本 POC 的原因是：`activeTab` 和 `scripting` 可以把扫描限定在用户当前主动操作的标签页；扫描逻辑运行在用户本机浏览器中，不需要云端登录、模拟账号或抓取平台公开数据。

## 数据结构

新增共享类型：

```ts
interface ExtensionScannedItem {
  title: string;
  sourceUrl: string;
  coverUrl?: string;
  visibleText?: string;
  sourcePlatform: "xiaohongshu";
}

interface ExtensionImportPayload {
  source: "browser-extension-poc";
  sourcePlatform: "xiaohongshu";
  scannedAt: string;
  pageUrl?: string;
  items: ExtensionScannedItem[];
}

interface SmartAlbum {
  id: string;
  title: string;
  description: string;
  category: Category;
  keywords: string[];
  savedItemIds: string[];
  coverItemId?: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}
```

## 如何本地加载扩展

1. 打开 Chrome 或 Edge。
2. 进入扩展管理页：`chrome://extensions/` 或 `edge://extensions/`。
3. 打开开发者模式。
4. 点击“加载已解压的扩展”。
5. 选择仓库中的 `apps/extension` 目录。
6. 打开你本人已登录的小红书网页版收藏夹。
7. 点击扩展按钮，选择“扫描当前可见卡片”或“轻滚动后扫描”。
8. 确认结果后点击“导入收藏复活”。

默认导入地址是线上 Web MVP：`https://xiaohongshu-green.vercel.app/`。如果要导入本地开发环境，可以把 popup 里的 Web 地址改成 `http://localhost:5173/`。

## 技术验证结论

1. Chrome 扩展是否可行：可行。Manifest V3 的 popup + activeTab + scripting 可以满足用户主动点击后扫描当前标签页 DOM 的 POC。
2. Microsoft Edge 扩展是否可行：可行。Edge 基于 Chromium 扩展体系，当前实现使用的是通用 MV3 能力，而不是 Chrome 商店专属能力。
3. 是否能读取当前可见收藏卡片：理论可行，取决于小红书网页版当前 DOM 中是否存在笔记链接和卡片文本。POC 会优先抓取 `a[href]` 中疑似小红书笔记链接，再向上寻找卡片容器。
4. 能提取哪些字段：较稳定的是链接 `sourceUrl`；相对可用的是标题 `title` 和可见短文本 `visibleText`；封面 `coverUrl` 取决于图片是否已加载到 DOM。
5. 哪些字段不稳定：标题、描述、封面选择器都依赖小红书前端 DOM 类名和结构，平台改版后可能失效。视频、评论、完整正文、博主主页信息都不在 POC 范围内。
6. 页面结构是否容易变化：容易变化。正式版需要做选择器容错、版本探测、失败提示和用户手动修正入口。
7. 是否需要用户手动打开收藏夹页面：需要。扩展不登录账号，也不导航到私密页面；用户必须自己登录并打开自己的收藏夹。
8. 是否需要用户手动滚动：第一版可以手动滚动后扫描；POC 也提供“轻滚动后扫描”，但它只是让页面懒加载内容进入 DOM，不保证扫完整个历史收藏夹。
9. 风险点：平台 DOM 改版、懒加载不稳定、页面虚拟列表导致旧卡片离开 DOM、URL 过长导致 hash 导入不适合几百条、用户误以为已经完整扫描全部收藏。
10. 替代方案：继续保留系统分享入口；提供 JSON/CSV 手动导入；让用户分批复制分享链接；后续可做浏览器书签脚本，但扩展的权限提示和交互更清晰。
11. 下一步正式版：做更稳的选择器适配、扫描预览确认页、分页/批量导入、防重复策略、失败项手动补录、导入大批量时改用扩展和 Web 的安全消息通道或本地文件导入，而不是 URL hash。

## 合规边界

- 不做云端爬虫。
- 不模拟账号登录。
- 不绕过验证码、风控或访问限制。
- 不抓取别人账号的数据。
- 不批量抓平台公开数据建库。
- 只在用户本机、用户自己登录页面、用户主动点击后运行。
- 扫描后先展示待导入清单，用户确认后才导入。
- 不保存原帖全文，不复制视频/图片内容，不重建小红书内容库。
