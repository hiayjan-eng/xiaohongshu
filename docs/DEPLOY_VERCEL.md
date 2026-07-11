# Vercel 部署说明

这份文档用于把「收藏复活系统」Web MVP 部署到 Vercel，拿到一个真正公开、方便朋友测试的网址。当前部署内容是 Web MVP，不是 PWA，不是真实 iOS / Android App，也没有接入真实小红书接口、真实 AI、登录或云同步。

## 为什么部署到 Vercel

`localhost` 只代表你当前电脑上正在运行的本地开发服务。只要 Vite 进程退出、电脑重启、端口被占用，或者 Codex 的临时运行环境变化，浏览器就可能出现 `ERR_CONNECTION_REFUSED`。部署到 Vercel 后，访问的是线上构建产物，有固定 URL，不需要本地一直开着 dev server。

## 当前项目形态

- 项目类型：Web MVP
- 包管理器：pnpm monorepo
- Web app：`apps/web`
- 数据存储：浏览器 `localStorage`
- AI：mock / 规则服务
- 移动端：`apps/mobile` 只是结构和原型预留
- 当前不包含：真实 App、PWA、登录、数据库、云同步、真实小红书接口、爬虫

## 部署前必须运行

```bash
pnpm install
pnpm check
```

`pnpm check` 会执行 typecheck、生产构建和 E2E。只有这一组检查通过，才建议部署。

## 推荐方式：连接 GitHub 仓库自动部署

把当前项目推到 GitHub 后，在 Vercel 控制台选择 Import Project，导入这个仓库。

Vercel 项目配置请填写：

- Framework Preset: `Vite`
- Root Directory: 仓库根目录，不要选 `apps/web`
- Install Command: `pnpm install`
- Build Command: `pnpm --filter @revival/web build`
- Output Directory: `apps/web/dist`

Root Directory 必须选仓库根目录，因为当前项目是 pnpm monorepo，Web app 在 `apps/web`，但依赖 `packages/*` 里的 workspace 包。如果 Root Directory 误设为 `apps/web`，Vercel 构建时可能找不到 `@revival/ai-service`、`@revival/database` 等本地包。

根目录已经有 `vercel.json`，内容会告诉 Vercel 使用 Vite、正确的构建命令、输出目录和 SPA 路由回退规则。

## SPA 路由刷新

当前 Web app 使用前端路由，包含：

- `/`
- `/dashboard`
- `/search`
- `/settings`
- `/qa`
- `/real-test`

部署后直接刷新 `/qa`、`/real-test`、`/search` 或 `/settings` 不应该 404。根目录 `vercel.json` 已配置：

```json
{
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

这会把前端路由回退到 Vite 构建出的 `index.html`。

## 给朋友测试前注意事项

当前线上版本会是公开 Web MVP，适合给朋友快速体验产品闭环，但它仍然是本地浏览器数据版本。

请提前告诉朋友：

- 数据存在各自浏览器的 `localStorage` 里。
- 不同朋友之间的数据不会同步。
- 同一个朋友换浏览器、换设备后，也不会自动看到之前的数据。
- 不要输入隐私信息、账号密码、身份证、手机号、私密地址或不想公开的原帖信息。
- 测试时可以在 `/real-test` 里粘贴 3-5 条真实收藏，完成评价后点击复制试用总结，再发给你。
- 当前 AI 分类和行动卡是 mock / 规则逻辑，适合验证产品流程和交互价值，不代表最终模型效果。

## 部署后手动检查

拿到 Vercel URL 后，至少检查这些路径：

- `/`
- `/qa`
- `/real-test`
- `/search`
- `/settings`

建议按下面顺序验收：

1. 打开首页，确认不是白屏。
2. 打开 `/qa`，导入 demo 数据。
3. 打开 `/real-test`，新增一条真实试用记录。
4. 刷新 `/real-test`，确认不 404。
5. 在 `/search` 搜索关键词，例如“大理”“剪辑”“低卡晚餐”。
6. 在 `/settings` 切换主题，刷新后确认主题保留。
7. 导入一条收藏，查看行动卡，标记已复活，确认奖励反馈出现。

## GitHub 首次提交参考

如果还没有远程仓库，先在 GitHub 创建一个空仓库，不要勾选自动生成 README、`.gitignore` 或 license。拿到仓库地址后，在本地执行：

```bash
git status
git add .
git commit -m "Prepare Vercel deployment"
git branch -M main
git remote add origin <你的 GitHub 仓库地址>
git push -u origin main
```

如果本地已经有提交，只需要把还没提交的改动提交后再推送：

```bash
git status
git add .
git commit -m "Update Vercel deployment docs"
git push
```

不要把 `.env`、`.vercel`、`node_modules`、`dist`、`playwright-report`、`test-results` 或本地日志文件提交到仓库。

## 手动使用 Vercel CLI

推荐优先用 GitHub 连接自动部署。如果想手动试一次，也可以使用 Vercel CLI：

```bash
pnpm deploy:check
pnpm dlx vercel login
pnpm dlx vercel --prod
```

首次部署时按前面的 Vercel 配置填写。不要把任何 Vercel token 写进代码或提交到仓库。

## 如果部署失败如何排查

### pnpm 或 lockfile 问题

确认仓库根目录有 `pnpm-lock.yaml`，Vercel 的 Install Command 是：

```bash
pnpm install
```

如果报 lockfile 不匹配，本地运行 `pnpm install` 后提交更新的 lockfile。

### Root Directory 配错

Root Directory 应该是仓库根目录。如果选成 `apps/web`，workspace 依赖可能无法解析。

### Output Directory 配错

当前 Vite 构建输出是：

```text
apps/web/dist
```

不要填成根目录 `dist`。

### Build Command 配错

当前构建命令是：

```bash
pnpm --filter @revival/web build
```

不要只写 `vite build`，否则 Vercel 可能不在正确的 workspace 上下文里构建。

### SPA 路由刷新 404

确认 `vercel.json` 中的 rewrites 存在，并且 Vercel 项目 Root Directory 是仓库根目录。刷新 `/qa`、`/real-test`、`/search`、`/settings` 都应该返回应用页面。

## 后续更新线上版本

后面继续优化功能时，正确流程是：

```bash
pnpm check
git status
git add .
git commit -m "描述这次改动"
git push
```

如果 Vercel 已连接 GitHub，push 后会自动生成新的 Preview Deployment；合并或推送到生产分支后会更新正式线上版本。功能优化不会天然破坏线上版本，但每次上线前都应该先跑 `pnpm check`，避免把核心闭环改坏。
## Current production and recovery status

Production URL: https://xiaohongshu-green.vercel.app

Before and after deployment, run:

```bash
pnpm check
pnpm verify:prod
```

`pnpm verify:prod` checks the Vercel SPA routes with Node `fetch`, including `/import`, `/albums`, `/old-import`, `/qa`, `/real-test`, `/search`, and `/settings`.

If GitHub push is blocked by network or credentials, do not force push or create another repository. Generate a bundle backup instead:

```bash
git bundle create release-artifacts/xiaohongshu-phase-latest.bundle --all
```

Then record the current HEAD, recent commits, status, production URL, deployment URL, and sync problem in `release-artifacts/current-project-state.txt`. Once GitHub connectivity returns, push the same `main` branch normally.