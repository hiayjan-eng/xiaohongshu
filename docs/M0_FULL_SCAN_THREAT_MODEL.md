# M0 全量扫描威胁模型

## 保护目标

- 用户的小红书登录态、Cookie 和账号身份；
- 收藏标题、作者、原帖 URL、封面及摘要；
- 已完成的扫描进度和本地收藏库；
- “本人发布笔记不得误导入”的硬边界；
- 平台验证码、风控与登录过期必须交给用户手动处理。

## 信任边界

小红书页面 DOM 属于不可信输入。content script 可以读取用户主动打开的当前页，但只能把严格收藏 root 内的卡片发送给扩展后台。Extension IndexedDB 是本地权威存储；Side Panel 是控制与展示层，不是数据存储层。Web Preview 导入桥本轮未接入，也没有远程服务。

## 主要威胁与控制

| 威胁 | 影响 | Spike 控制 |
| --- | --- | --- |
| 收藏/本人笔记共用 card DOM | 本人帖子误导入 | URL、主/子 tab、收藏 panel、滚动容器和 own-post panel 九项联合门；禁止 `document.body` fallback |
| 隐藏面板仍在 DOM | 扫描非当前 tab | 只观察可见激活收藏 root；own-post panel 位于 root 内时直接拒绝开始 |
| 虚拟列表回收旧卡片 | 全量结果缺失 | MutationObserver 在卡片进入 DOM 时立即提取并写 IndexedDB |
| 重复渲染、空轮、刷新 | 重复插入或提前结束 | session relation 主键去重、5 个稳定空轮、scroll geometry、最终唯一 sourceId 核验 |
| Side Panel 关闭或 service worker 休眠 | 进度丢失 | item/session/checkpoint 均在 Extension IndexedDB；UI 只保留统计与最近 12 条 |
| 页面刷新、第二天继续 | 续跑到错误账号 | 恢复前重新计算 `profileIdHash` 与 `favoritesPageIdentity`，不一致则 `needs_user` |
| 验证码、风控、登录过期 | 绕过平台控制或数据错误 | 立即安全暂停，显示原因；不自动处理验证码，不模拟登录 |
| 恶意标题/URL | UI 注入或错误链接 | Side Panel 使用 `textContent`；URL 仅接受小红书 host，sourceId 白名单，canonical URL 重建 |
| 内存随 3000 条线性增长 | 扩展崩溃 | 内容缓冲 25、recent 12、虚拟 DOM 有界；全量条目只落 IndexedDB |
| Cookie 或收藏外传 | 隐私泄露 | 不读取/上传 Cookie，不调用远程服务，不在云端抓取 |
| service worker 消息中断 | 部分批次丢失 | 单批事务原子提交；失败时不推进 checkpoint，扫描进入安全暂停 |

## 明确禁止

- 模拟登录、扫码登录或 Cookie 提取；
- 绕过验证码、反爬或风险控制；
- 把逆向 API 作为唯一数据源；
- 扫描点赞页、隐藏面板或本人发布笔记面板；
- 上传收藏、Cookie 或诊断中的原始 ID；
- 在无法确认页面边界时尝试“尽量扫描”；
- 将 AGPL/商业代码复制进当前扩展。

## 脱敏诊断

Side Panel 诊断只展示 profile hash、page identity hash、selector version、root/scroll 描述、计数、状态和最终核验；session ID、batch ID 与 last source ID 再次脱敏，不展示收藏标题、完整作者或完整 URL。

## 剩余风险

真实小红书 DOM selector 尚未在本轮接入和实测；平台结构变化可能导致严格拒绝开始，这是安全失败而不是静默 fallback。网络失败目前验证了“安全暂停并可恢复”，真实 M0 仍需在不触发风控的前提下校准重试退避、最长运行时间和内存阈值提示。
