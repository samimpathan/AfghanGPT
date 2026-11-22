-- ============================================================
-- Samim AI — migration studio-001 (studios tables)
-- Run in Supabase SQL Editor (project kmofyrkgwpgqztcggtaq):
--   https://supabase.com/dashboard/project/kmofyrkgwpgqztcggtaq/sql/new
-- Paste this whole file, press Run. It is idempotent (IF NOT EXISTS).
--
-- IMPORTANT (DevConnect lesson): tables created by raw SQL get NO
-- privileges by default. The GRANTs at the end are REQUIRED —
-- without them every read fails with Postgres 42501 before RLS
-- is even evaluated.
-- ============================================================

-- ---------- studio_chats ----------
create table if not exists public.studio_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- studio_messages ----------
create table if not exists public.studio_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.studio_chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  mode text,
  created_at timestamptz not null default now()
);
create index if not exists studio_messages_chat_id_idx on public.studio_messages (chat_id);

-- ---------- studio_projects ----------
create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('code', 'app', 'doc')),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- studio_files ----------
create table if not exists public.studio_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.studio_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null,
  content text not null default '',
  updated_at timestamptz not null default now()
);
create index if not exists studio_files_project_id_idx on public.studio_files (project_id);

-- ---------- studio_workflows ----------
create table if not exists public.studio_workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- studio_workflow_runs ----------
create table if not exists public.studio_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid references public.studio_workflows (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  input text not null default '',
  output text not null default '',
  error text,
  created_at timestamptz not null default now()
);

-- ---------- studio_images ----------
create table if not exists public.studio_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null default '',
  ratio text not null default '1:1',
  storage_path text,
  created_at timestamptz not null default now()
);

-- ---------- Row Level Security: own rows only ----------
alter table public.studio_chats enable row level security;
alter table public.studio_messages enable row level security;
alter table public.studio_projects enable row level security;
alter table public.studio_files enable row level security;
alter table public.studio_workflows enable row level security;
alter table public.studio_workflow_runs enable row level security;
alter table public.studio_images enable row level security;

drop policy if exists studio_chats_own on public.studio_chats;
create policy studio_chats_own on public.studio_chats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists studio_messages_own on public.studio_messages;
create policy studio_messages_own on public.studio_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists studio_projects_own on public.studio_projects;
create policy studio_projects_own on public.studio_projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists studio_files_own on public.studio_files;
create policy studio_files_own on public.studio_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists studio_workflows_own on public.studio_workflows;
create policy studio_workflows_own on public.studio_workflows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists studio_workflow_runs_own on public.studio_workflow_runs;
create policy studio_workflow_runs_own on public.studio_workflow_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists studio_images_own on public.studio_images;
create policy studio_images_own on public.studio_images
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- GRANTs (REQUIRED — raw-SQL tables get none by default) ----------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.studio_chats to authenticated;
grant select, insert, update, delete on public.studio_messages to authenticated;
grant select, insert, update, delete on public.studio_projects to authenticated;
grant select, insert, update, delete on public.studio_files to authenticated;
grant select, insert, update, delete on public.studio_workflows to authenticated;
grant select, insert, update, delete on public.studio_workflow_runs to authenticated;
grant select, insert, update, delete on public.studio_images to authenticated;
grant select on public.studio_chats to anon;
grant select on public.studio_messages to anon;
grant select on public.studio_projects to anon;
grant select on public.studio_files to anon;
grant select on public.studio_workflows to anon;
grant select on public.studio_workflow_runs to anon;
grant select on public.studio_images to anon;

-- ---------- shared_chats: chats the owner shared publicly ----------
-- A shared chat is readable by ANYONE with the link (public SELECT);
-- only the owner can create or delete it. Used by /share/[id].
-- If this table is missing (migration not run yet), sharing falls
-- back to a .md download and says so — never a fake link.
create table if not exists public.shared_chats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'نوی چټ',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.shared_chats enable row level security;
drop policy if exists shared_chats_select_public on public.shared_chats;
create policy shared_chats_select_public on public.shared_chats
  for select using (true);
drop policy if exists shared_chats_insert_own on public.shared_chats;
create policy shared_chats_insert_own on public.shared_chats
  for insert with check (auth.uid() = owner_id);
drop policy if exists shared_chats_delete_own on public.shared_chats;
create policy shared_chats_delete_own on public.shared_chats
  for delete using (auth.uid() = owner_id);
grant select on public.shared_chats to anon, authenticated;
grant insert, delete on public.shared_chats to authenticated;

-- Verify with:
--   select count(*) from public.studio_chats;   -- expect 0, HTTP 200
--   select count(*) from public.studio_projects; -- expect 0, HTTP 200
--   select count(*) from public.shared_chats;   -- expect 0, HTTP 200
