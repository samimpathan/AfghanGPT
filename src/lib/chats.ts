import { supabase } from "./supabaseClient";

export type ChatRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type MessageRow = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export function chatTitleFrom(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > 40 ? clean.slice(0, 40) + "…" : clean || "نوی چټ";
}

export async function listChats(userId: string): Promise<ChatRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("ai_chats")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as ChatRow[];
}

export async function createChat(userId: string, title: string): Promise<ChatRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("ai_chats")
    .insert({ user_id: userId, title })
    .select()
    .single();
  if (error) return null;
  return data as ChatRow;
}

export async function renameChat(chatId: string, title: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("ai_chats")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", chatId);
  return !error;
}

export async function deleteChat(chatId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("ai_chats").delete().eq("id", chatId);
  return !error;
}

export async function listMessages(chatId: string): Promise<MessageRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("ai_messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) return [];
  return (data ?? []) as MessageRow[];
}

export async function saveMessage(
  chatId: string,
  role: "user" | "assistant",
  content: string
): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("ai_messages")
    .insert({ chat_id: chatId, role, content });
  if (error) return false;
  await supabase
    .from("ai_chats")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", chatId);
  return true;
}

/** Update one message's text (own row only — RLS enforces ownership). */
export async function updateMessage(messageId: string, content: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("ai_messages")
    .update({ content })
    .eq("id", messageId);
  return !error;
}

/** Delete one message row (own row only — RLS enforces ownership). */
export async function deleteMessage(messageId: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("ai_messages").delete().eq("id", messageId);
  return !error;
}
