# 收藏复活旧收藏扫描 Beta

这是一个 Manifest V3 浏览器扩展 Beta，用于验证“用户本人主动点击后，扫描自己小红书网页版当前已加载收藏卡片”的产品路径。它支持 Chrome 和 Microsoft Edge 的开发者模式加载，当前不是 Chrome Web Store 或 Edge Add-ons 正式版本。

## 构建

在仓库根目录运行：

```bash
pnpm --filter @revival/extension build
```

构建产物：

- `release-artifacts/extension-beta`：加载已解压扩展时选择这个目录。
- `release-artifacts/collection-revival-extension-beta-v0.2.1.zip`：可给测试用户下载的 Beta ZIP。
- `apps/web/public/downloads/collection-revival-extension-beta-v0.2.1.zip`：Web 端 `/old-import` 页面使用的下载文件。

## 安装

1. 打开 Chrome 的 `chrome://extensions/` 或 Edge 的 `edge://extensions/`。
2. 开启开发者模式。
3. 点击“加载已解压的扩展”。
4. 选择 `release-artifacts/extension-beta`。
5. 打开本人小红书网页版收藏夹，再点击扩展。

## 使用

扩展会先检查当前页面是否像小红书页面，以及是否存在登录、验证码、频繁访问等阻塞信号。用户可以扫描当前可见卡片，也可以开启自动轻滚动扫描。自动扫描支持暂停、继续和清空断点，扫描结果会先在 popup 中展示，用户确认后再导入 Web MVP 的 `/old-import`。

## 数据边界

扩展只读取当前标签页 DOM 中已经加载出来的基础信息，例如标题、链接、封面 URL、可见短文本、作者和类型猜测。它不登录账号、不绕过验证码、不后台抓取、不上传扫描结果到第三方服务，也不复制原帖完整图文、视频、评论区或博主主页数据。

## 校验

```bash
pnpm --filter @revival/extension typecheck
```

校验会检查 Manifest V3、必要权限、popup/content script 语法，以及暂停/继续、断点、页面状态探测、Beta 导入来源等关键能力标记。
