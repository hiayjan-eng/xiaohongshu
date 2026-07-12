# 收藏复活系统 MVP

收藏复活是一个 Web MVP，用来把用户主动分享进来的收藏内容转成可执行的行动卡、计划和可搜索索引。它的核心目标不是整理更多收藏，而是帮助用户把曾经心动过的内容重新捡起来：能搜索找回原帖，也能知道今天可以从哪一步开始。

## 当前已经完成

- 模拟分享导入：保存 `sourceUrl`、`title`、`rawShareText` 和 `userNote`。
- mock AI 自动分类：覆盖技能学习、旅行地点、美食探店、菜谱做饭、穿搭变美、家居生活、工作效率、灵感素材和其他。
- 行动卡生成：根据分类生成下一步行动、任务、结构化字段和预计耗时。
- 搜索找回：支持关键词搜索、匹配原因展示、“打开原帖”和“查看行动卡”。
- 今日复活：Dashboard 推荐 1-3 条适合执行的行动卡。
- 收藏池和计划库：可以查看已导入内容、状态和简单计划。
- 主题系统：支持 5 套预设主题，刷新后保持选择。
- 完成奖励和轻成就：完成行动卡后进入“已复活”状态，并更新基础统计。
- QA 自检页：`/qa` 支持重置和导入 20 条 demo 数据。
- E2E 回归测试：Playwright 已覆盖核心 MVP 闭环，目前基线为 17 passed。

## 当前不是哪些东西

这个项目当前不是 PWA，不是真实 iOS / Android App，也没有接入真实小红书接口。它不会登录小红书账号，不读取用户收藏夹，不做批量爬虫，不保存或公开展示原帖完整内容。完整内容仍然通过 `sourceUrl` 回到原平台查看。

同时，当前也没有登录系统、云同步、正式数据库、真实 AI 服务、手机系统分享入口、原生桌面小组件或 Electron 桌面端。

## 项目结构

```text
apps/
  web/       Vite + React Web MVP
  mobile/    未来移动端和分享入口的结构预留，不是完整原生 App
packages/
  shared-types/
  ai-service/
  search-service/
  action-card-service/
  recommendation-service/
  database/
docs/
  MVP_QA_REPORT.md
  RELEASE_CHECKLIST.md
  REAL_USER_TEST_TEMPLATE.md
```

## 安装

```bash
pnpm install
```

## 本地启动

```bash
pnpm --filter @revival/web dev -- --host 0.0.0.0 --port 5173
```

打开：

- Web app: `http://localhost:5173/`
- QA 自检页: `http://localhost:5173/qa`
- 真实试用模式: `http://localhost:5173/real-test`

## QA 自检页

`/qa` 用来快速确认本地 mock 数据和核心状态是否正常。你可以在这里一键重置 demo 数据、一键导入 demo 数据，并查看 SavedItem、ActionCard、今日推荐、已完成数量、成就数量和当前主题。页面里也有入口可以直接进入 `/real-test`。


## 预览打不开时

如果浏览器提示 `ERR_CONNECTION_REFUSED`，通常表示本地 Vite 预览服务没有在 5173 端口持续运行。可以直接执行：

```bash
pnpm preview:start
```

也可以绕过 pnpm，直接运行 PowerShell 脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-web-preview.ps1
```

启动成功后打开 `http://localhost:5173/real-test`。日志会写入根目录的 `web-preview-5173.log` 和 `web-preview-5173.err.log`。
## 测试

运行 E2E 回归测试：

```bash
pnpm test:e2e
```

打开 Playwright UI：

```bash
pnpm test:e2e:ui
```

使用有头浏览器模式调试：

```bash
pnpm test:e2e:headed
```

## 发布前检查

每次准备进入稳定状态前，运行完整检查：

```bash
pnpm check
```

它会依次执行 typecheck、Web build 和 E2E 测试。快速检查可以使用：

```bash
pnpm check:quick
```

更详细的发布前流程见 `docs/RELEASE_CHECKLIST.md`。


## Vercel 部署

这个 Web MVP 可以部署到 Vercel，拿到一个稳定线上网址，避免依赖本地 `localhost:5173`。部署前运行：

```bash
pnpm check
```

Vercel 推荐选择仓库根目录作为 Root Directory，Build Command 使用 `pnpm --filter @revival/web build`，Output Directory 使用 `apps/web/dist`。详细说明见 `docs/DEPLOY_VERCEL.md`。
## 下一阶段计划

建议下一阶段先用 `/real-test` 跑 20 条真实小红书收藏，重点观察分类准确率、行动卡有用率、搜索找回率和用户是否愿意今天执行。`docs/REAL_USER_TEST_TEMPLATE.md` 可以作为离线备份模板，但优先使用网页内置流程。等真实试用结果稳定后，再考虑接入真实 AI、设计正式数据存储，以及验证手机系统分享入口。

## Production smoke test

Current production URL: https://xiaohongshu-green.vercel.app

Run the production route smoke test with:

```bash
pnpm verify:prod
```

This uses Node `fetch` to verify `/`, `/dashboard`, `/import`, `/albums`, `/old-import`, `/qa`, `/real-test`, `/search`, and `/settings` return the SPA shell. See `docs/PRODUCTION_SMOKE_TEST.md` for the full checklist.

Current GitHub sync note: local `main` may be ahead of `origin/main` if this environment cannot reach GitHub. When connectivity is restored, run `git push origin main`. A recovery bundle can be generated under `release-artifacts/` for handoff.
## AI provider configuration

默认模式仍然是 mock/local rules，不需要网络，也不需要 API Key。真实 AI 现在通过服务端 `/api/ai` 代理接入：前端只调用自己的后端接口，真实 Key 只能放在 Vercel Environment Variables 或本地服务端 `.env.local` 中，不能放进任何会进入浏览器 bundle 的变量名里。

`.env.example` 只保留空模板：

```bash
AI_PROVIDER=mock
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=
AI_TIMEOUT_MS=30000
```

支持的模式：

- `AI_PROVIDER=mock`：默认本地 mock provider，不发起真实模型请求。
- `AI_PROVIDER=openai-compatible`：服务端 OpenAI-compatible chat completions provider，需要在服务端配置 `AI_API_KEY`。

如果没有 Key、接口超时、返回 JSON 不合法，Web 端会继续 fallback 到 mock，导入、搜索、智能专辑和真实试用页不能白屏。详细配置见 `docs/AI_PROVIDER_SETUP.md` 和 `docs/AI_PROVIDER_AND_PROMPTS.md`。
## Phase 2/3 架构状态

当前版本已经把 AI 和存储的下一阶段接入点拆出来，但默认仍然是稳定的本地 Web MVP。

- AI：`packages/ai-service` 提供 `AiProvider`、`MockAiProvider` 和 OpenAI-compatible provider 链路。没有服务端 `AI_API_KEY` 时继续使用 mock fallback，不消耗网络请求。
- Prompt：统一放在 `packages/ai-service/src/prompts.ts`，边界是只生成私人摘要、行动建议和搜索索引，不复制小红书原帖全文。
- 同步：`packages/storage-service` 覆盖 SavedItem、ActionCard、ImportBatch、SmartAlbum、Task、Plan、Achievement、SearchLog、RealUserTestRecord。默认 localStorage；Supabase adapter 需要项目 URL、anon key、Auth 和 RLS 验证后才能启用。
- 设置页：现在会显示 AI 状态和同步状态，避免把 mock/localStorage 误认为真实云端能力。

相关文档：

- `docs/AI_PROVIDER_AND_PROMPTS.md`
- `docs/SUPABASE_SCHEMA.md`
- `docs/AUTH_AND_SYNC_PLAN.md`
## Phase 4-6 状态

当前版本继续保持 Web MVP 为主，不引入真实 App、PWA、登录或云同步。Phase 4-6 已补齐以下可验证资产：

- Mobile：`apps/mobile` 仍是 skeleton，已补 `docs/MOBILE_SHARE_TECH_SPEC.md` 和 `docs/MOBILE_MVP_SCOPE.md`，说明 iOS Share Extension / Android Send Intent 如何进入统一 ImportBatch 管线。
- Extension Beta：`apps/extension` 现在有 `pnpm --filter @revival/extension build`，输出 `release-artifacts/extension-beta`，可作为 Chrome / Edge unpacked Beta 安装测试。
- Friend Test：`/real-test` 顶部有朋友测试入口说明，`/qa` 有线上测试提醒，`docs/FRIEND_TEST_GUIDE.md` 可直接作为测试 SOP。

相关命令：

```bash
pnpm --filter @revival/mobile typecheck
pnpm --filter @revival/extension typecheck
pnpm --filter @revival/extension build
pnpm check
```
