# 登录与同步计划

当前状态：Web MVP 仍是本地模式，数据存在当前浏览器 localStorage。Phase 3 只准备 adapter、schema 和迁移策略，不假装云同步已经完成。

## 推荐第一版登录方式

先使用 Supabase Auth 邮箱登录，避免一开始接太多 OAuth 平台。登录后数据写入 Supabase；未登录时继续保留 localStorage 模式，用户可以完整体验导入、搜索、今日复活、智能专辑和真实试用。

## 本地到云端迁移流程

1. 用户登录。
2. 系统检测当前浏览器 localStorage 是否已有 SavedItem、ActionCard、ImportBatch、SmartAlbum 等数据。
3. 显示迁移预览：本地数据条数、云端已有条数、可能重复的 sourceUrl 数量。
4. 用户选择：迁移到云端、暂不迁移、导出 JSON 后再决定。
5. 迁移时按 sourceUrl 和 id 去重，冲突项保留云端版本，并把本地版本作为可下载冲突报告。
6. 迁移完成后再切到云端读写。

## 冲突策略

- sourceUrl 相同：默认视为同一条收藏，保留较新的 userNote、status、updatedAt。
- 同一 SavedItem 多张 ActionCard：保留最新一张，旧卡可以写入历史字段，第一版不展示。
- SmartAlbum 冲突：以云端已确认专辑为准，候选专辑可重新生成。
- Achievement 冲突：已解锁状态取并集，不重复解锁。

## 退出登录

退出登录后必须清空云端会话态，不展示上一位用户的云端数据。可以继续展示本地 demo，但要明确这是当前浏览器本地数据。

## 数据导出与删除

正式接云前需要保留：

- 导出 JSON：SavedItem、ActionCard、ImportBatch、SmartAlbum、RealUserTestRecord。
- 删除本地数据：清空 localStorage。
- 删除云端数据：需要登录后逐表删除自己的数据，并保留二次确认。

## 隐私边界

- 不上传原帖全文和媒体文件。
- 不扫描非用户本人账号。
- 不绕过小红书登录、验证码或风控。
- 浏览器扩展扫描结果必须先进入待导入清单，用户确认后再入库。

## 当前 BLOCKED

需要 Supabase 项目、Auth 配置、数据库迁移权限和 RLS 验证。没有这些凭证前，产品只显示“本地模式 / 云同步待配置”。
