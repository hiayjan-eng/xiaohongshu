# Codex 后续工作流

## 1. 基本原则

后续每一轮只接受一个产品目标。目标必须先归入实施阶段：数据底座、扫描可靠性、Web 核心体验、云同步、手机 App、AI 个性化或商店发布。没有归属的需求先写设计，不直接改代码。

工作顺序固定为：

```text
审计当前代码
→ 写出本轮设计和风险
→ 最小实现
→ 自动化测试
→ 本地 smoke
→ 提交
→ 部署
→ 线上真实 UI 验收
→ 报告
```

如果用户明确要求只做计划或文档，本轮不得修改业务代码、不得提交、不得部署。

## 2. 禁止跨阶段顺手修改

以下行为禁止：

- 修数据底座时顺手改分类 taxonomy。
- 修扫描状态时顺手改扩展 selector 或 manifest，除非本轮目标就是扫描可靠性。
- 做 Web 体验时顺手接 Supabase。
- 做 AI 时让 `pnpm check` 依赖真实 API Key。
- 做手机 App 时把 WebView 当作原生分享入口完成。
- 做商店发布时扩大扩展权限。

任何“顺手修一下”的冲动都必须回到本轮目标检查。

## 3. 每轮状态门

开始前必须记录：

- `git status -sb`
- 当前 HEAD commit
- 是否有用户未提交修改
- production URL 和已知 deployment
- 本轮允许修改的目录
- 本轮禁止修改的目录

如果工作区已有用户改动，必须识别它们，不得回滚。

## 4. 设计门

改代码前必须回答：

- 当前状态是什么。
- 目标状态是什么。
- 哪些代码可复用。
- 哪些字段或状态机会改变。
- 是否需要迁移。
- 是否需要外部凭证。
- 失败停止条件是什么。

如果需要 Supabase、AI Key、Apple、Google、Chrome 或 Edge 开发者账号，而用户尚未提供，必须停下，不写假连接。

## 5. 测试门

默认门禁：

```bash
pnpm typecheck
pnpm check
git diff --check
```

按阶段补充：

- 分类：运行分类评估集，记录一级准确率、Top3 和高置信误判率。
- 扩展：`pnpm --filter @revival/extension typecheck` 和 `pnpm --filter @revival/extension build`。
- 迁移：运行 fixture migration tests，验证备份和撤销。
- 生产：`pnpm verify:prod` 或对应线上 route 检查。

如果沙箱权限阻止 build 或 E2E，报告必须写清是环境问题，不能说测试通过。

## 6. 部署门

部署只在用户明确要求时执行。部署前必须：

- `pnpm check` 完整通过。
- commit 已创建。
- push 到 GitHub 成功。
- 确认 Vercel 使用根目录、Vite、`pnpm install`、`pnpm --filter @revival/web build`、`apps/web/dist`。

部署后必须记录：

- commit hash。
- Vercel deployment id。
- production status。
- production URL。
- local bundle hash。
- production bundle hash。
- SPA 刷新路径。

## 7. 真实 UI 验收

不能只用代码推断线上已经正确。每次影响 UI 或路由，都必须验证：

- `/`
- `/dashboard`
- `/import`
- `/old-import`
- `/albums`
- `/albums/:albumId`
- `/search?q=AI`
- `/settings`

如果涉及扩展，还要验证：

- ZIP 下载。
- 扩展连接状态。
- READY/PING/PONG。
- 扫描状态同步。
- 导入 Web。

报告必须区分：

- 干净浏览器验证。
- 用户原浏览器仍需手动迁移或清理。
- 只在本地通过，尚未线上验证。

## 8. 报告格式

每轮最终报告包含：

1. 本轮目标。
2. 修改文件。
3. 没有修改的冻结模块。
4. 数据迁移情况。
5. 测试结果。
6. commit hash。
7. deployment id，如有。
8. 线上验证结果，如有。
9. 已知限制。
10. 下一步建议。

如果本轮只做文档，报告只写创建了哪些文档、核心结论、最大架构问题、推荐第一阶段、需要冻结的功能和是否修改业务代码。

## 9. token 预算控制

长任务必须先拆阶段。每一轮只做一个阶段内最小闭环，不把“数据底座 + App + AI + 云同步 + 扩展商店”混在一起。

如果上下文接近耗尽：

- 先写状态摘要。
- 保留当前文件改动和测试结果。
- 不开始新的子任务。
- 不在未验证状态下提交或部署。

## 10. 失败停止条件

以下情况必须停止并报告：

- 外部凭证缺失。
- 真实平台限制或合规边界不清。
- 测试失败原因不明。
- 迁移可能破坏用户现有数据。
- production 与本地 bundle 不一致。
- 扩展真实扫描回归。
- 分类评估低于门槛。
- 用户要求暂停功能开发或只做设计。

## 11. 冻结规则

在非对应阶段不得修改：

- extension manifest、bridge、scanner selector、暂停继续、断点恢复和导入协议。
- classification-service taxonomy、64 条评估集和 provider 架构。
- Vercel 部署结构。
- 手机 App 承诺范围。
- 用户 localStorage 数据。

冻结不是永远不能改，而是必须进入明确阶段、先写设计和停止条件，再动代码。

## 12. Codex 自检清单

每次开工前问自己：

- 我是不是在解决用户当前要求，而不是上一个遗留目标？
- 我有没有先审计真实代码？
- 我是否正在修改本轮不允许修改的文件？
- 我是否把当前状态和目标状态写清楚？
- 我是否需要外部凭证？
- 我是否能用测试证明没有破坏核心闭环？
- 如果我要部署，线上 UI 是否会被真实验证？
