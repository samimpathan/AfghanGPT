import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client. Keys come from NEXT_PUBLIC_ env vars only.
 * If they are absent, the client is null and the app still works in
 * guest/offline mode (chats saved in localStorage) with a setup banner.
 * Key VALUES are never printed or logged anywhere.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null =
  isSupabaseConfigured && url && anonKey
    ? createClient(url, anonKey)
    : null;
