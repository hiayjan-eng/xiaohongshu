# M0 真实全量扫描实现

## 交付范围

本实现只交付 `0.3.0-m0-preview`：Side Panel 一键扫描本人小红书“收藏 → 笔记”、自动滚动、Extension IndexedDB 流式保存、中断恢复、结果复核、精确 Preview 导入、批次撤销和原帖打开。没有修改分类、专辑、搜索、行动卡、App、迁移、main 或 Production。

## 数据流

```text
小红书收藏笔记 panel
→ full-scan-content.js
→ full-scan-core.js
→ background service worker
→ collection-revival-m0-preview-v1（Extension IndexedDB）
→ Side Panel 分页复核
→ 精确 M0 Preview origin 的分块桥
→ collection-revival-m0-preview-v1（Preview Web IndexedDB）
```

扫描任务不依赖 popup。Side Panel 只保留统计、当前批次和最近 12 条；收藏全量对象由 Extension IndexedDB 持有。每批最多 25 条写入，Preview 导入每块最多 200 条。

## 严格页面识别

`selectorVersion` 为 `m0-real-favorites-v3`。开始与恢复前同时确认：官方 `xiaohongshu.com` host、本人 `/user/profile/<id>`、收藏 query、可见激活“收藏”主 tab、可见激活“笔记”子 tab、可见收藏 panel、收藏 root、本人发布/点赞 panel 排除，以及无登录失效、验证码、风控或网络错误。

任何一项不满足都会拒绝开始或安全暂停。扫描核心没有 `document.body` fallback，也不会把 profile 链接当作笔记链接。

## 自动滚动与完成条件

滚动容器在收藏 panel 内部滚动与 `document.scrollingElement` 之间动态判断。每轮按视口步进，不瞬间跳到底；MutationObserver、loading 状态、短安静窗口和最长保护窗口共同控制等待。卡片一进入 DOM 就提取并写入 IndexedDB，因此虚拟列表回收不会丢失旧记录。

完成需要同时满足：真实底部、至少 5 个无新增周期、scrollHeight/sentinel 稳定、loading 结束、无继续加载入口、无风险/网络阻断，以及最终唯一 sourceId 与 IndexedDB relation 数一致。

## 恢复

ScanSession 持久化 `profileIdHash`、`favoritesPageIdentity`、scroll checkpoint、计数、状态、恢复次数、selectorVersion 和 extensionVersion。页面刷新、Side Panel 重开、service worker 重建或浏览器恢复后，只在账号 hash 与收藏页身份完全一致且页面仍通过严格识别时继续。不同账号或页面不会自动续跑。

## 复核、导入与撤销

Side Panel 支持最近记录、搜索、稳定随机 50 条、脱敏诊断和仅含脱敏统计的 JSON 导出。扫描完成前不自动导入。

导入目标是构建时写入的唯一精确 Vercel Preview origin。目标页先从 Preview IndexedDB 计算新增、已存在和待检查数量，用户确认后才分块写入。每批保存 `scanSessionId`、`importBatchId`、`extensionVersion`、`importedAt`；撤销只删除该 `importBatchId` 首次新增的记录。

去重顺序为 sourceId、canonicalSourceUrl、标题+作者+摘要 fallback hash。原帖打开顺序为 userCorrectedSourceUrl、canonicalSourceUrl、rawSourceUrl，并拒绝 profile 或非小红书笔记路径。
