# Supabase Schema 草案

当前状态：Phase 3 只完成 schema 和 adapter 边界设计。项目仍默认使用 localStorage；没有 Supabase 项目 URL、anon key、迁移权限和 RLS 策略前，不启用云同步。

## 核心原则

- 每张业务表都必须带 `user_id`，并通过 Row Level Security 限制用户只能访问自己的数据。
- 不保存小红书原帖全文、评论区、博主主页数据或完整媒体内容。
- 保存的是用户主动导入的信息、AI 摘要、行动卡、搜索索引、状态和用户自己的备注。
- localStorage 迁移到云端必须由用户确认，不能静默覆盖。

## 表结构

### users

由 Supabase Auth 管理，业务侧可额外维护 profile。

- id uuid primary key
- email text
- display_name text
- created_at timestamptz
- updated_at timestamptz

### saved_items

- id text primary key
- user_id uuid references auth.users(id)
- source_platform text
- source_url text
- raw_share_text text
- title text
- user_note text
- category text
- intent text
- summary text
- keywords text[]
- entities jsonb
- searchable_text text
- embedding vector 或 jsonb，可后续启用
- status text
- created_at timestamptz
- updated_at timestamptz

建议唯一约束：`unique(user_id, source_url)`，当 source_url 为空时用 title + raw_share_text 的 hash 做本地去重辅助。

### action_cards

- id text primary key
- user_id uuid references auth.users(id)
- saved_item_id text references saved_items(id)
- category text
- title text
- goal text
- next_action text
- estimated_time text
- difficulty text
- fields jsonb
- created_at timestamptz
- updated_at timestamptz

### tasks

- id text primary key
- user_id uuid references auth.users(id)
- action_card_id text references action_cards(id)
- title text
- description text
- estimated_time text
- due_date date null
- status text
- sort_order int

### import_batches

- id text primary key
- user_id uuid references auth.users(id)
- source text
- title text
- status text
- raw_count int
- imported_count int
- duplicate_count int
- failed_count int
- created_action_card_count int
- created_album_count int
- error_message text null
- created_at timestamptz
- updated_at timestamptz

### import_batch_items

- id text primary key
- user_id uuid references auth.users(id)
- batch_id text references import_batches(id)
- source_url text
- title text
- raw_share_text text
- visible_text text null
- cover_url text null
- user_note text
- status text
- duplicate_of_saved_item_id text null
- created_saved_item_id text null
- created_action_card_id text null
- error_message text null
- created_at timestamptz

### smart_albums

- id text primary key
- user_id uuid references auth.users(id)
- title text
- description text
- category text
- keywords text[]
- cover_item_id text null
- priority int
- status text
- created_at timestamptz
- updated_at timestamptz

### album_items

- album_id text references smart_albums(id)
- saved_item_id text references saved_items(id)
- user_id uuid references auth.users(id)
- sort_order int
- primary key (album_id, saved_item_id)

### plans

- id text primary key
- user_id uuid references auth.users(id)
- title text
- type text
- duration_days int
- description text
- action_card_ids text[]
- tasks jsonb
- status text
- created_at timestamptz
- updated_at timestamptz

### achievements

- id text primary key
- user_id uuid references auth.users(id)
- title text
- description text
- condition text
- icon text
- theme_color text
- unlocked_at timestamptz

### search_logs

- id text primary key
- user_id uuid references auth.users(id)
- query text
- result_count int
- clicked_saved_item_id text null
- opened_from_search boolean default false
- created_at timestamptz

### real_user_test_records

- id text primary key
- user_id uuid references auth.users(id)
- saved_item_id text
- source_url text
- title text
- raw_share_text text
- user_note text
- category text
- summary text
- keywords text[]
- entities jsonb
- next_action text
- classification_rating text null
- action_card_rating text null
- next_step_rating text null
- today_willingness text null
- search_query text null
- search_found boolean null
- search_match_reason text null
- reward_rating text null
- issue_note text null
- created_at timestamptz
- updated_at timestamptz

## RLS 草案

每张业务表开启 RLS，并使用类似策略：

```sql
create policy "Users can read own rows" on saved_items
for select using (auth.uid() = user_id);

create policy "Users can insert own rows" on saved_items
for insert with check (auth.uid() = user_id);

create policy "Users can update own rows" on saved_items
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "Users can delete own rows" on saved_items
for delete using (auth.uid() = user_id);
```

正式迁移前必须为所有业务表补齐同类策略，并在非生产项目里验证。

## 当前 BLOCKED

需要用户创建 Supabase 项目，提供 URL、anon key，并允许执行数据库迁移。RLS 没验证前不能上线云同步。
