# M0 全量扫描技术 Spike 架构

## 范围

这一轮只验证 Chrome Extension 内的全量扫描架构，不接触真实用户数据，不修改 Web 产品的分类、专辑、搜索、行动卡或导入实现，也不部署 Production。旧 popup 与 0.2.4 Scanner 被保留作为基线参考；扩展 action 在该 Spike 分支改为打开 Side Panel，全量路径由新增模块独立承担。

## 组件与数据流

```text
用户打开“本人 profile → 收藏 → 笔记”
  ↓
Side Panel：发出开始/暂停/继续/停止命令，只显示统计和最近 12 条
  ↓ chrome.tabs.sendMessage
full-scan-content.js
  ↓
full-scan-core.js：九项身份门、收藏 root、真实滚动容器、MutationObserver、完成状态机
  ↓ 每批最多 25 条，发现即发送
background.js
  ↓
full-scan-idb.js：Extension origin IndexedDB 原子事务
  ├─ scanSessions
  ├─ favoriteItems
  └─ scanSessionItems
```

Side Panel 关闭不影响 content script 继续运行；service worker 每次收到流式消息都会从扩展 IndexedDB 恢复并执行短事务。页面刷新会终止当前 content runtime，但 ScanSession 和收藏条目仍在扩展 origin，重新验证同一脱敏账号与页面身份后可继续。

## 页面身份硬门

`inspectFavoritesPage` 同时要求：

1. hostname 为 `xiaohongshu.com` 子域；
2. pathname 为 `/user/profile/<id>`；
3. query 明确为 favorites；
4. 可见激活主 tab 文本为“收藏”；
5. 可见激活子 tab 文本为“笔记”；
6. 能定位非 `document.body` 的收藏面板；
7. 滚动容器等于收藏面板或位于其内部；
8. 本人笔记面板不在扫描 root 内；
9. 页面不存在可见验证码、风控、登录过期或网络错误遮挡。

任一条件不满足就返回明确 code，并显示“为避免导入本人发布内容，本次未开始扫描”。全量核心不存在 `document.body` fallback。

## 流式采集与虚拟列表

MutationObserver 只观察收藏 root 的 `childList/subtree`。新增卡片进入 DOM 后立即提取 `sourceId`、raw URL、canonical URL、标题、作者、封面、可见摘要、时间与 session ID；旧卡片随后被虚拟列表回收不影响已写入数据。

内容脚本不保存全量 `Set` 或条目数组。单次持久化批次上限为 25，Side Panel 最近项上限为 12；全局和 session 内去重由 IndexedDB 主键及关系表完成。

## IndexedDB 与去重

`favoriteItems` 使用 `favoritesPageIdentity + dedupeKey` 作为 storage key；`scanSessionItems` 使用 `sessionId + dedupeKey` 记录本轮唯一关系。去重键优先级为：

1. `source:<sourceId>`
2. `url:<canonicalSourceUrl>`
3. `fallback:<title|author|excerpt hash>`

每个批次在一个 readwrite transaction 中同时写 item、session relation 和 ScanSession checkpoint。重复 DOM 卡片只增加诊断计数，不会重复插入；最终完成前按 session relation 重新核对关系数、唯一 sourceId 数和 `duplicateInsertCount`。

## ScanSession

持久化字段完整覆盖指令要求：

```text
sessionId
profileIdHash
favoritesPageIdentity
status
startedAt
updatedAt
discoveredCount
validCount
duplicateCount
invalidCount
lastSourceId
lastScrollTop
lastScrollHeight
stableNoGrowthCycles
retryCount
selectorVersion
extensionVersion
itemsCheckpoint
```

另外保存 `importBatchId`、`existingCount`、`newItemCount`、`duplicateInsertCount` 和脱敏错误状态。恢复只接受同一 `favoritesPageIdentity`；账号或页面变化时进入 `needs_user`，不会自动续跑旧 session。

## 滚动与完成状态机

每轮滚动收藏真实容器到底部，并用 MutationObserver 活动、loading 状态和短 quiet window 共同等待；计时器只是异常保护，不是固定长 sleep 的唯一完成条件。偶发空轮会再次触发同一容器的滚动事件，不会被一次无增长误判为完成。

完成必须同时满足：

- 容器已到底；
- 至少 5 个周期无新增；
- scrollHeight 与 sentinel 至少 5 个周期稳定；
- loading 结束；
- 不存在继续加载按钮；
- 没有风控、登录或网络错误；
- IndexedDB 最终全局去重核验一致。

## Spike 与真实 M0 的边界

本轮证明架构可行，但没有声称真实小红书 3000 条扫描已经完成。真实 M0 下一轮仍需把经过用户实页验证的 selector 映射进严格 root 定位，增加真实网络重试/长时间保护和导入桥验收；在真实账号验收完成前，产品级 `M0_STATUS` 仍不得标记为 Release Candidate。
