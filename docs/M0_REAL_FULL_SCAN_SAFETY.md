# M0 真实全量扫描安全说明

## 数据边界

- Extension 数据库：`collection-revival-m0-preview-v1`。
- Preview Web 数据库：同名但位于独立 Web origin，各自受浏览器 origin 隔离。
- M0 Preview 不读取 Production localStorage，不迁移、清空或覆盖 Production 收藏库。
- 扫描与导入均在浏览器本地完成，不上传 Cookie、token、账号 ID、收藏正文或诊断明细。
- 真实收藏不会进入 Git、测试 fixture、console 日志或远程第三方服务。

## 页面安全门

扫描必须确认本人 profile、收藏 query、激活收藏主 tab、激活笔记子 tab和可见收藏 root；本人发布 panel、点赞 panel、隐藏 panel、profile 链接均排除。无法同时确认时，系统显示“为避免导入本人发布内容，本次未开始扫描”，不会尝试扩大范围。

验证码、风控、登录失效、离线或持续网络错误只会触发安全暂停、保存进度并等待用户处理。实现不绕过验证码、不模拟登录、不读取 Cookie。

## Origin 与扩展权限

`0.3.0-m0-preview` 构建必须提供一个完整 HTTPS Vercel origin。构建器拒绝路径、通配符、Production `xiaohongshu-green.vercel.app` 和非 Vercel host。最终 manifest 只允许：

- `https://www.xiaohongshu.com/*`
- `https://xiaohongshu.com/*`
- 一个精确 M0 Preview origin

后台会再次校验 build profile 只有一个 origin，并核对 Web 消息 sender origin；Production 或任意其他 Vercel 页面不能请求导入数据。

## 诊断脱敏

诊断只包含计数、状态、时间、selectorVersion、滚动模式、布尔核验和 hash。sessionId、importBatchId、完整 page identity、完整 sourceId、标题、作者、正文、URL token 与账号 ID 不进入诊断导出。

## 已验证硬门槛

- `OWN_POST_FALSE_IMPORT_COUNT = 0`
- 3000 fixture = 3000
- 5000 fixture = 5000
- 中断恢复后最终数量一致
- 第二次完整扫描新增 = 0
- DOM 峰值 61；Side Panel recent 峰值 12
- Preview Production sentinel 未变化
- Preview origin 数据库列表只出现 `collection-revival-m0-preview-v1`
