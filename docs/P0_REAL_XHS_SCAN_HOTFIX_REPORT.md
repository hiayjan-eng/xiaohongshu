# P0 现场复验阻断：扩展扫描按钮无响应热修

## 范围和边界

这次只处理真实小红书收藏页已复验失败的闭环：收藏页识别、卡片提取回退、10/20 上限、点击扫描后的即时反馈，以及 Preview 导入目标。没有修改数据底座、迁移、DeepSeek、网页业务功能或生产包；没有创建 PR、合并 main、Promote 或部署 Production。

## 修复内容

- 收藏页确认与提取就绪状态分离。`collectionPageConfirmed` 只依赖小红书个人页、非受限状态，以及 `tab=fav`（使用 `URLSearchParams`，不依赖查询参数顺序）或可见的活动“收藏”标签；零张候选卡片会报告 `EXTRACTION_EMPTY`，不会再错误显示为“不是收藏页”。
- 优先提取收藏容器；若该容器没有可用卡片，会回退到 `document.body`，按可见性去重后提取 `/explore/`、`/discovery/item/`、嵌套链接和 `data-note-id` / `data-id` 卡片，并排除作者主页、导航链接。
- 扫描上限统一为 10 或 20。popup、scanner、状态和进度中不再使用 200、500 或 1000。
- 点击“开始扫描”会立刻切换到加载状态、禁用按钮并显示“正在检查当前收藏页…”。失败会在按钮和进度区域展示错误；已确认收藏页但零提取时会展示可操作的脱敏诊断，而不是静默失败。
- 诊断只包含页面确认、路由/活动标签信号、根类型和计数、过滤原因、selector 版本；不包含用户标题、作者、链接或 ID，并可复制。

## 脱敏回归

新增扩展 DOM 夹具，不含真实昵称、标题或笔记 ID，覆盖：查询参数反序、活动收藏标签、首选根为空时的 body fallback、瀑布流卡片、嵌套带 `xsec` 参数的笔记链接、`data-note-id` 卡片和作者主页链接排除。

| 发布门 | 结果 |
| --- | --- |
| 扩展静态校验与 DOM fixture | PASS |
| Preview 打包校验 | PASS |
| 生产 profile 保持 0.2.3 / 生产导入目标 | PASS |
| Preview profile 0.2.4 / 精确 Preview origin / 无 `*.vercel.app` | PASS |
| `git diff --check`（代码阶段） | PASS |

## 交付物

- 目录：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\extension-beta-preview`
- ZIP：`C:\Users\86178\Documents\小红书收藏夹\release-artifacts\collection-revival-extension-beta-preview-v0.2.4.zip`
- Preview 导入目标：`https://xiaohongshu-git-p0-core-revival-loop-rescue-ayj.vercel.app/old-import`

生产候选包仍为 0.2.3；Preview 0.2.4 不使用通配符 Vercel 域名，也不要求用户填写隐藏配置。

## 真实页面复验标准

在同一真实收藏页中，活动“收藏”标签和可见卡片存在时：先应看到已确认收藏页，点击开始扫描应立即有加载反馈，目标上限只能是 10 或 20。若暂时抽取不到卡片，界面必须保留“已确认收藏页”的判断并显示 `EXTRACTION_EMPTY` 诊断，不能回退为“不是收藏页”或无反馈。识别到卡片后，结果和进度不得再显示 `0/200`。

自动化校验不能替代此真实页面复验。待当前 P0 分支的 Preview 别名更新到本次提交后，状态进入用户复验阶段。
P0_REAL_XHS_SCAN_STATUS: READY_FOR_USER_RETEST
