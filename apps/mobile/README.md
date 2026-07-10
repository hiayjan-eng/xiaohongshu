# 手机端预留

第一版 MVP 的手机页面原型在 `apps/web` 中可直接预览，真实 App 接入时可以把这里升级成 Expo / React Native 工程。

当前保留的核心边界是系统分享入口：用户从小红书或其他内容平台主动分享链接和可用文本，本 App 只接收这份分享 payload，然后复用共享服务生成行动卡和搜索索引。

后续接入建议：

- iOS：Share Extension 读取 `NSExtensionItem` 中的 URL 和文本。
- Android：处理 `ACTION_SEND` / `ACTION_SEND_MULTIPLE`，第一阶段只接收单条用户主动分享。
- 归一化后统一调用 `normalizeIncomingShare()`，再进入 `classifyAndGenerateActionCard()`。
