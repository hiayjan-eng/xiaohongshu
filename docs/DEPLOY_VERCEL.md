# Vercel 部署说明

这份文档用于把「收藏复活」Web MVP 部署到 Vercel，拿到一个稳定的线上网址，避免每天依赖 `localhost:5173` 本地服务。

## 为什么要部署上线

`localhost` 只代表你当前电脑上正在运行的本地开发服务。只要 Vite 进程退出、电脑重启、端口被占用，或者 Codex 的临时运行环境变化，浏览器就可能提示 `ERR_CONNECTION_REFUSED`。部署到 Vercel 后，访问的是线上构建产物，有固定 URL，不需要你本地一直开着 dev server。

## 当前部署内容

当前部署的是 Web MVP，不是 PWA，也不是真实 iOS / Android App。上线后仍然可以继续新增功能和优化页面；每次提交代码后，Vercel 可以重新构建并生成新的线上版本。

需要注意的是，当前数据仍然存在浏览器 `localStorage` 里。线上部署后，同一台设备同一个浏览器可以保留本地数据，但换浏览器、换设备不会自动同步。AI 分类仍然是 mock / 规则服务，没有接真实模型。

## 部署前必须运行

在准备部署前先运行：

```bash
pnpm install
pnpm check
```

`pnpm check` 会执行 typecheck、生产构建和 E2E。只有这一步通过，才建议部署。

## 方式一：连接 GitHub 仓库自动部署

这是推荐方式。把当前项目推到 GitHub 后，在 Vercel 中导入这个仓库。

推荐配置：

- Framework Preset: `Vite`
- Root Directory: 仓库根目录，不要选 `apps/web`
- Install Command: `pnpm install`
- Build Command: `pnpm --filter @revival/web build`
- Output Directory: `apps/web/dist`

Root Directory 选择根目录的原因是：当前项目是 pnpm monorepo，Web app 在 `apps/web`，但它依赖 `packages/*` 里的 workspace 包。如果只把 Root Directory 设成 `apps/web`，Vercel 构建时可能找不到这些本地包。

根目录已经提供 `vercel.json`，会告诉 Vercel 构建命令、输出目录和 SPA 路由回退规则。

## 方式二：使用 Vercel CLI 手动部署

如果你想先手动试一次，可以安装并登录 Vercel CLI：

```bash
pnpm dlx vercel login
pnpm dlx vercel
```

首次部署时，按下面思路选择：

- Link to existing project: 根据实际情况选择
- Project root: 当前仓库根目录
- Build Command: 使用 `vercel.json` 中的配置
- Output Directory: 使用 `apps/web/dist`

正式发布生产版本时可以运行：

```bash
pnpm deploy:check
pnpm dlx vercel --prod
```

不要在代码里写任何 Vercel token。需要登录时使用 Vercel CLI 自己的登录流程，或者在 Vercel 控制台连接 GitHub。

## SPA 路由刷新

当前 Web app 是前端路由，包含：

- `/`
- `/dashboard`
- `/search`
- `/settings`
- `/qa`
- `/real-test`

部署后直接刷新 `/qa` 或 `/real-test` 不应该 404。根目录 `vercel.json` 已经配置：

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

## 部署后手动检查

上线后打开 Vercel URL，至少检查：

- 首页能打开
- `/qa` 能打开
- `/real-test` 能打开
- 刷新 `/real-test` 不 404
- 主题切换正常，刷新后仍然保留
- 能导入一条收藏
- 搜索正常，并能展示匹配原因
- 查看行动卡正常
- 完成奖励正常
- 真实试用模式可以新增一条记录并测试搜索

## 如果部署失败怎么排查

### pnpm 版本问题

确认 Vercel 使用的是 pnpm，并且根目录有 `pnpm-lock.yaml`。如果 Vercel 没识别到 pnpm，可以在项目设置里显式设置 Install Command 为：

```bash
pnpm install
```

### monorepo Root Directory 问题

Root Directory 建议选择仓库根目录。如果选择了 `apps/web`，workspace 依赖如 `@revival/ai-service`、`@revival/database` 可能无法解析。

### Output Directory 错误

当前 Vite 构建输出在：

```text
apps/web/dist
```

如果 Vercel 配成了 `dist`，它会在根目录找 `dist`，结果可能找不到产物。

### Build Command 错误

当前构建命令应该是：

```bash
pnpm --filter @revival/web build
```

不要只写 `vite build`，否则 Vercel 可能不在正确的 workspace 上下文里构建。

### SPA 路由刷新 404

确认 `vercel.json` 里的 rewrites 存在，并且部署使用的是仓库根目录配置。刷新 `/qa`、`/real-test` 时，应该回到 `index.html`。

### packages 依赖无法解析

确认 `pnpm-workspace.yaml` 包含：

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

同时确认 `apps/web/package.json` 里的 workspace 依赖仍然是 `workspace:*`。
