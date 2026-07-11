# 数据同步路线图

当前 MVP 仍然使用 localStorage 和 mock database。第二阶段新增 `packages/storage-service`，目的是把未来云同步需要的读写接口先稳定下来，而不是现在就接真实数据库。

## 当前状态

- Web 端数据保存在浏览器 localStorage。
- 不同浏览器、不同设备之间不会同步。
- AI 仍然是 mock/rules 服务。
- 没有登录系统。
- 浏览器扩展导入会打开 Web，把数据交给 Web 本地保存。

## StorageAdapter 目标

统一以下数据的读写接口：

- SavedItem
- ActionCard
- ImportBatch
- ImportBatchItem
- SmartAlbum
- Achievement

当前实现：

- `LocalStorageAdapter`：封装本地 localStorage。
- `SupabaseAdapter`：只预留接口，不连接真实 Supabase。

## 未来云同步阶段

下一阶段如果进入云同步，需要补齐：

1. 登录系统
   - 用户身份
   - 多端会话
   - Web / App / Extension 共享账号

2. 云数据库
   - Users
   - SavedItems
   - ActionCards
   - ImportBatches
   - ImportBatchItems
   - SmartAlbums
   - Plans
   - SearchLogs
   - Achievements

3. 多端同步
   - Web 导入后 App 可见
   - App 分享后 Web 可见
   - Extension 扫描后进入同一账号

4. 数据隐私边界
   - 不保存原帖全文
   - 不保存小红书账号密码
   - 不抓取用户未确认导入的内容
   - 支持删除导入记录和导出个人数据

5. 迁移策略
   - localStorage 导出 JSON
   - 云端导入确认
   - 冲突处理：sourceUrl 去重优先，用户编辑内容优先保留

## 不在当前阶段做的事

- 不接真实数据库。
- 不接登录。
- 不做云同步。
- 不上传扩展扫描结果到第三方服务。
- 不改变现有 Vercel 部署方式。