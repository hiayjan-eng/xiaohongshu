# Legacy Settings 刷新持久化审计

## 结论

`CONFIRMED_ROOT_CAUSE: FIXTURE_RESEED_ON_RELOAD`

`CONTRIBUTING_FACTORS: NONE`

此前的生产 Smoke 诊断通过 `page.addInitScript` 注入 `lavender-mint` fixture。Playwright 会在每次导航与 reload 执行该脚本，因此测试在用户选择 `dawn` 后刷新时重新写回了旧 fixture 值。LocalStorageRuntime 没有在 hydrate 阶段覆盖新值。

## Legacy settings authority

在 `LocalStorageRuntime` 模式中，theme 的唯一 authority 是独立 key：

`collection-revival-theme`

写入由 `LocalStorageRuntime.persistProductSettings` 完成，hydrate 由 `LocalStorageRuntime.readSettings` 从同一 key 读取。主 AppState 不序列化 settings；其中即使存在过期的 `settings.themeId` snapshot，也不是 authority。冲突时独立 theme key 优先。achievements 保持独立的 `collection-revival-achievements` key。

## 最小修复

未修改 production Runtime、settings service、IndexedDB、迁移、Prepare 或 Activation 协议。新增的回归测试以一次性 localStorage fixture setup 后 reload 的方式启动应用，避免 `addInitScript` 在后续 reload 重写测试数据。

## 验证

- 新增 `legacy-settings-persistence.spec.ts`：3/3 通过。
- 覆盖独立 key 对过期 AppState snapshot 的优先级、Legacy fixture 的 `lavender-mint → dawn → reload → dawn`、空白用户刷新、achievements/AppState 保留，以及 Marker/业务 IndexedDB 不创建。
- storage-runtime：70 tests / 295 assertions 通过。
- storage-service：181 tests / 826 assertions 通过。
- `pnpm typecheck`：通过。
- `pnpm check`：通过，包括 core E2E 与 heavy E2E 的 3,000 / 10,000 场景。
- 本地 production-preview 隔离 Smoke A–D：通过；桌面 1440×900、移动 390×844，移动无横向滚动。

## 未触碰范围与风险

未访问真实用户数据，未读主浏览器 Profile，未调用 DeepSeek，未写 IndexedDB、Marker 或 Journal，未执行迁移、Prepare、Activation、push、merge 或 deploy。

生产尚未部署本轮测试修正；当前线上 Smoke 状态不得改写为 PASS。若后续发布任何相关变更，应以新的隔离 Chromium Context 重跑 Production Smoke。

## 回滚

本轮没有 production logic 变更。若需回退，只需移除对应的回归测试；不存在数据迁移、存储删除或不可逆状态变更。
