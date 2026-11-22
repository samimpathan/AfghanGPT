"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ChatMessage, { type UiMessage } from "@/components/ChatMessage";
import { useUi } from "@/components/Providers";
import { t, LANGS, type Lang } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { isAdminEmail } from "@/lib/admin";
import {
  listChats,
  createChat,
  renameChat as renameChatDb,
  deleteChat as deleteChatDb,
  listMessages,
  saveMessage,
  chatTitleFrom,
  type ChatRow,
} from "@/lib/chats";

type LocalChat = {
  id: string;
  title: string;
  dbId?: string;
  messages: UiMessage[];
};

const GUEST_KEY = "samim-ai-guest-chats";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

function loadGuestChats(): LocalChat[] {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalChat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function HomePage() {
  const { lang, setLang, theme, setTheme } = useUi();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [chats, setChats] = useState<LocalChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatsRef = useRef<LocalChat[]>([]);
  chatsRef.current = chats;

  const active = chats.find((c) => c.id === activeId) ?? null;
  const messages: UiMessage[] = active?.messages ?? [];
  const isAdmin = isAdminEmail(userEmail);

  // Persist guest chats locally.
  useEffect(() => {
    if (userId) return; // logged-in chats live in Supabase
    try {
      localStorage.setItem(GUEST_KEY, JSON.stringify(chats));
    } catch {
      // ignore
    }
  }, [chats, userId]);

  // Auth session + load history.
  useEffect(() => {
    if (!supabase) {
      setChats(loadGuestChats());
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session?.user) {
        setChats(loadGuestChats());
        return;
      }
      setUserEmail(session.user.email ?? null);
      setUserId(session.user.id);
      const rows: ChatRow[] = await listChats(session.user.id);
      const loaded: LocalChat[] = rows.map((r) => ({
        id: r.id,
        dbId: r.id,
        title: r.title,
        messages: [],
      }));
      setChats(loaded);
      if (loaded.length > 0) setActiveId(loaded[0].id);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const lastMessageContent = messages[messages.length - 1]?.content ?? "";
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, lastMessageContent]);

  const newChat = useCallback(() => {
    const c: LocalChat = { id: uid(), title: t(lang, "newChat"), messages: [] };
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
  }, [lang]);

  const selectChat = useCallback(async (id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
    const chat = chatsRef.current.find((c) => c.id === id);
    if (!chat) return;
    if (chat.dbId && chat.messages.length === 0) {
      const rows = await listMessages(chat.dbId);
      const msgs: UiMessage[] = rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
      }));
      setChats((prev) =>
        prev.map((c) => (c.id === id ? { ...c, messages: msgs } : c))
      );
    }
  }, []);

  const send = useCallback(
    async (text: string, regenerate = false) => {
      const clean = text.trim();
      if (!clean || streaming) return;
      let chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
      if (!chat) {
        chat = { id: uid(), title: chatTitleFrom(clean), messages: [] };
        setChats((prev) => [chat!, ...prev]);
        setActiveId(chat.id);
      }
      const chatId = chat.id;

      let history: { role: "user" | "assistant"; content: string }[];
      if (regenerate) {
        const base = [...chat.messages];
        while (base.length > 0 && base[base.length - 1].role === "assistant") base.pop();
        history = base.map((m) => ({ role: m.role, content: m.content }));
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, messages: base } : c))
        );
      } else {
        const userMsg: UiMessage = { id: uid(), role: "user", content: clean };
        history = [
          ...chat.messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: clean },
        ];
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  title: c.messages.length === 0 ? chatTitleFrom(clean) : c.title,
                  messages: [...c.messages, userMsg],
                }
              : c
          )
        );
      }

      // Ensure a Supabase chat row exists for logged-in users.
      let dbId = chat.dbId;
      if (userId && supabase && !dbId) {
        const row = await createChat(userId, chatTitleFrom(clean));
        if (row) {
          dbId = row.id;
          setChats((prev) =>
            prev.map((c) => (c.id === chatId ? { ...c, dbId: row.id } : c))
          );
        }
      }
      if (userId && dbId && !regenerate) {
        await saveMessage(dbId, "user", clean);
      }

      const assistantId = uid();
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  { id: assistantId, role: "assistant", content: "" },
                ],
              }
            : c
        )
      );

      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      let full = "";
      let mode: "gemini" | "offline" | "refused" = "offline";
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });
        const headerMode = res.headers.get("X-SamimAI-Mode");
        if (headerMode === "gemini" || headerMode === "offline" || headerMode === "refused") {
          mode = headerMode;
        }
        if (!res.ok || !res.body) throw new Error("API error");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          const snapshot = full;
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: snapshot, mode } : m
                    ),
                  }
                : c
            )
          );
        }
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          // Stopped by the user — keep the partial reply.
        } else if (!full) {
          full = t(lang, "errorGeneric");
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId ? { ...m, content: full, mode } : m
                    ),
                  }
                : c
            )
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }

      // Drop an empty assistant bubble (e.g. stopped immediately).
      if (!full.trim()) {
        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? { ...c, messages: c.messages.filter((m) => m.id !== assistantId) }
              : c
          )
        );
      } else if (userId && dbId) {
        await saveMessage(dbId, "assistant", full);
      }
    },
    [activeId, streaming, userId, lang]
  );

  const stop = () => abortRef.current?.abort();

  const doRename = async (id: string) => {
    const title = editingTitle.trim();
    if (!title) {
      setEditingId(null);
      return;
    }
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    setEditingId(null);
    const chat = chatsRef.current.find((c) => c.id === id);
    if (chat?.dbId) await renameChatDb(chat.dbId, title);
  };

  const doDelete = async (id: string) => {
    if (!window.confirm(t(lang, "deleteConfirm"))) return;
    const chat = chatsRef.current.find((c) => c.id === id);
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
    if (chat?.dbId) await deleteChatDb(chat.dbId);
  };

  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );

  const suggestions = [
    t(lang, "suggestion1"),
    t(lang, "suggestion2"),
    t(lang, "suggestion3"),
    t(lang, "suggestion4"),
  ];

  return (
    <div className="flex h-dvh bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "fixed inset-y-0 z-40 flex w-72" : "hidden"
        } flex-col border-e border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 md:static md:flex md:w-72`}
      >
        <div className="flex items-center gap-2 p-3">
          <Image
            src="/avatar.jpg"
            alt="Samim AI"
            width={40}
            height={40}
            className="rounded-full object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {t(lang, "appName")}
              {isAdmin && (
                <span className="ms-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-black">
                  {t(lang, "admin")}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500">Samim AI</p>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-200 md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>
        <div className="px-3">
          <button
            type="button"
            onClick={newChat}
            className="w-full rounded-xl bg-[#2457FF] px-3 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
          >
            + {t(lang, "newChat")}
          </button>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(lang, "searchChats")}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div className="chat-scroll mt-2 flex-1 overflow-y-auto px-2 pb-2">
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-slate-500">
              {t(lang, "noChats")}
            </p>
          )}
          {filtered.map((c) => (
            <div
              key={c.id}
              className={`group mb-1 rounded-xl px-2 py-2 text-sm ${
                c.id === activeId
                  ? "bg-slate-200 dark:bg-slate-800"
                  : "hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {editingId === c.id ? (
                <input
                  autoFocus
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onBlur={() => doRename(c.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doRename(c.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => selectChat(c.id)}
                  className="block w-full truncate text-start"
                >
                  {c.title}
                </button>
              )}
              <div className="mt-1 flex gap-2 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(c.id);
                    setEditingTitle(c.title);
                  }}
                >
                  {t(lang, "rename")}
                </button>
                <button
                  type="button"
                  onClick={() => doDelete(c.id)}
                  className="text-red-500"
                >
                  {t(lang, "delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 p-3 text-xs dark:border-slate-800">
          <div className="flex flex-wrap gap-3">
            <Link href="/settings" className="text-slate-600 hover:underline dark:text-slate-300">
              ⚙ {t(lang, "settings")}
            </Link>
            <Link href="/about" className="text-slate-600 hover:underline dark:text-slate-300">
              ℹ {t(lang, "about")}
            </Link>
            {isAdmin && (
              <Link href="/admin" className="font-bold text-amber-600 hover:underline dark:text-amber-400">
                ★ {t(lang, "admin")}
              </Link>
            )}
            {userEmail ? (
              <span className="truncate text-slate-500">{userEmail}</span>
            ) : (
              <Link href="/login" className="font-bold text-[#2457FF] hover:underline">
                {t(lang, "login")}
              </Link>
            )}
          </div>
          <p className="mt-2 text-slate-400">{t(lang, "notMuse")}</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-full border border-slate-300 px-3 py-1 md:hidden"
            aria-label="Menu"
          >
            ☰
          </button>
          <Image
            src="/avatar.jpg"
            alt="Samim AI"
            width={36}
            height={36}
            className="rounded-full object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">
              {t(lang, "appName")}
              {isAdmin && (
                <span className="ms-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-black">
                  {t(lang, "admin")}
                </span>
              )}
            </p>
            <p className="text-xs text-slate-500">
              {streaming ? t(lang, "thinking") : t(lang, "tagline")}
            </p>
          </div>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="rounded-full border border-slate-300 bg-transparent px-2 py-1 text-xs dark:border-slate-700"
            aria-label={t(lang, "language")}
          >
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="rounded-full border border-slate-300 px-2.5 py-1 text-xs dark:border-slate-700"
            aria-label={t(lang, "theme")}
          >
            {theme === "dark" ? "☀ " + t(lang, "light") : "🌙 " + t(lang, "dark")}
          </button>
        </header>

        {!isSupabaseConfigured && (
          <div className="bg-amber-100 px-3 py-2 text-center text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {t(lang, "setupNeeded")}
          </div>
        )}
        {!userEmail && isSupabaseConfigured && (
          <div className="bg-blue-50 px-3 py-2 text-center text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-100">
            {t(lang, "guestNote")}{" "}
            <Link href="/login" className="font-bold underline">
              {t(lang, "login")}
            </Link>
            {" / "}
            <Link href="/register" className="font-bold underline">
              {t(lang, "register")}
            </Link>
          </div>
        )}

        <div className="chat-scroll flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {messages.length === 0 ? (
            <div className="mx-auto max-w-2xl py-10 text-center">
              <Image
                src="/avatar.jpg"
                alt="Samim AI"
                width={96}
                height={96}
                className="mx-auto rounded-full object-cover"
              />
              <h1 className="mt-4 text-xl font-bold">{t(lang, "welcomeTitle")}</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {t(lang, "welcomeText")}
              </p>
              <div className="mt-6 grid gap-2 text-start sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-2xl border border-slate-300 px-4 py-3 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((m, i) => (
                <ChatMessage
                  key={m.id}
                  msg={m}
                  lang={lang}
                  isLastAssistant={
                    m.role === "assistant" && i === messages.length - 1 && !streaming
                  }
                  onRegenerate={
                    m.role === "assistant" && i === messages.length - 1
                      ? () => {
                          const lastUser = [...messages]
                            .reverse()
                            .find((x) => x.role === "user");
                          if (lastUser) send(lastUser.content, true);
                        }
                      : undefined
                  }
                />
              ))}
              {streaming && messages[messages.length - 1]?.content === "" && (
                <div className="rounded-3xl bg-[#EDEEF0] px-4 py-3 text-slate-500 dark:bg-slate-800">
                  ● ● ●
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
            setInput("");
          }}
          className="border-t border-slate-200 p-3 dark:border-slate-800"
        >
          <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-full bg-slate-100 px-3 py-2 dark:bg-slate-800">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t(lang, "askPlaceholder")}
              className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none"
            />
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white"
                aria-label={t(lang, "stop")}
              >
                ■
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2457FF] text-white disabled:opacity-40"
                aria-label={t(lang, "send")}
              >
                ↑
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            Samim AI • {t(lang, "notMuse")}
          </p>
        </form>
      </main>
    </div>
  );
}
