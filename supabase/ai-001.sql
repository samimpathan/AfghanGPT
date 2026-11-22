-- Samim AI — migration ai-001
-- NEW tables only. Do NOT touch any DevConnect table.
-- Run this file ONCE in the Supabase Dashboard → SQL Editor → New query → paste → Run.
-- It is safe to run again: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS.

-- 1) Chats: one row per conversation, owned by one user.
create table if not exists public.ai_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'نوی چټ',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Messages: one row per message inside a chat.
create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.ai_chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  created_at timestamptz not null default now()
);

-- 3) Indexes for fast history loading.
create index if not exists ai_chats_user_updated_idx
  on public.ai_chats (user_id, updated_at desc);
create index if not exists ai_messages_chat_created_idx
  on public.ai_messages (chat_id, created_at asc);

-- 4) Row Level Security — ON for both tables.
alter table public.ai_chats enable row level security;
alter table public.ai_messages enable row level security;

-- 5) Policies for ai_chats: a user can ONLY touch their OWN chats.
drop policy if exists "ai_chats_select_own" on public.ai_chats;
create policy "ai_chats_select_own" on public.ai_chats
  for select using (auth.uid() = user_id);

drop policy if exists "ai_chats_insert_own" on public.ai_chats;
create policy "ai_chats_insert_own" on public.ai_chats
  for insert with check (auth.uid() = user_id);

drop policy if exists "ai_chats_update_own" on public.ai_chats;
create policy "ai_chats_update_own" on public.ai_chats
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ai_chats_delete_own" on public.ai_chats;
create policy "ai_chats_delete_own" on public.ai_chats
  for delete using (auth.uid() = user_id);

-- 6) Policies for ai_messages: a user can ONLY touch messages of their OWN chats.
drop policy if exists "ai_messages_select_own" on public.ai_messages;
create policy "ai_messages_select_own" on public.ai_messages
  for select using (
    exists (
      select 1 from public.ai_chats c
      where c.id = ai_messages.chat_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "ai_messages_insert_own" on public.ai_messages;
create policy "ai_messages_insert_own" on public.ai_messages
  for insert with check (
    exists (
      select 1 from public.ai_chats c
      where c.id = ai_messages.chat_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "ai_messages_update_own" on public.ai_messages;
create policy "ai_messages_update_own" on public.ai_messages
  for update using (
    exists (
      select 1 from public.ai_chats c
      where c.id = ai_messages.chat_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.ai_chats c
      where c.id = ai_messages.chat_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "ai_messages_delete_own" on public.ai_messages;
create policy "ai_messages_delete_own" on public.ai_messages
  for delete using (
    exists (
      select 1 from public.ai_chats c
      where c.id = ai_messages.chat_id and c.user_id = auth.uid()
    )
  );

-- 7) Verify (run after the migration, still in SQL Editor):
--    select count(*) from public.ai_chats;      -- must return 0, no error
--    select count(*) from public.ai_messages;   -- must return 0, no error
