-- Samim AI — fix ai-002: GRANTs for ai_chats + ai_messages
-- WHY: tables created by raw SQL get NO privileges by default, so anon /
-- authenticated roles get 42501 "permission denied" and login + chat saving fail.
-- This is the same root cause as the DevConnect PROFILE 404 fix.
-- Run ONCE in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.ai_chats to anon, authenticated;
grant select, insert, update, delete on public.ai_messages to anon, authenticated;

-- Verify (run after, still in SQL Editor):
--   select count(*) from public.ai_chats;      -- must return 0, no error
--   select count(*) from public.ai_messages;   -- must return 0, no error
-- And from the app / REST with the anon key, both tables must return HTTP 200, not 401.
