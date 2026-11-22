"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ChatMessage, { type UiMessage } from "@/components/ChatMessage";
import { useUi } from "@/components/Providers";
import { t, LANGS } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { isAdminEmail } from "@/lib/admin";
import {
  listChats,
  createChat,
  renameChat as renameChatDb,
  deleteChat as deleteChatDb,
  listMessages,
  saveMessage,
  updateMessage,
  deleteMessage,
  chatTitleFrom,
  type ChatRow,
} from "@/lib/chats";
import {
  createRecognizer,
  isSpeechRecognitionSupported,
  stopSpeaking,
  type SpeechRecognitionInstance,
} from "@/lib/voice";

type LocalChat = {
  id: string;
  title: string;
  dbId?: string;
  messages: UiMessage[];
};

const GUEST_KEY = "samim-ai-guest-chats";
const GUEST_ACTIVE_KEY = "samim-ai-guest-active";
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

/** Logged-in user's display name: full_name saved at register, else the email prefix. */
function displayNameOf(user: {
  user_metadata?: Record<string, unknown>;
  email?: string;
} | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata?.full_name;
  if (typeof meta === "string" && meta.trim()) return meta.trim();
  const prefix = (user.email ?? "").split("@")[0];
  return prefix || null;
}

function loadGuestActiveId(chats: LocalChat[]): string | null {
  try {
    const saved = localStorage.getItem(GUEST_ACTIVE_KEY);
    if (saved && chats.some((c) => c.id === saved)) return saved;
  } catch {
    // ignore
  }
  return chats[0]?.id ?? null;
}

/** Downscale a photo client-side to max 1024px (JPEG 0.8) before sending. */
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const MAX = 1024;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("no canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

/** Three animated dots, like the typing indicator in the video. */
function TypingDots() {
  return (
    <span className="flex items-center gap-1.5 px-1 py-2">
      <span className="typing-dot inline-block h-2 w-2 rounded-full bg-[#555555] dark:bg-slate-300" />
      <span className="typing-dot inline-block h-2 w-2 rounded-full bg-[#555555] dark:bg-slate-300" />
      <span className="typing-dot inline-block h-2 w-2 rounded-full bg-[#555555] dark:bg-slate-300" />
    </span>
  );
}

export default function HomePage() {
  const { lang, setLang, theme, setTheme } = useUi();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [chats, setChats] = useState<LocalChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string } | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [chatTime] = useState(() =>
    new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);
  // True once the initial load (guest storage or Supabase) has run.
  // The persist effect must NOT write before this, or it would overwrite
  // the saved guest chats with [] on first paint.
  const loadedRef = useRef(false);
  const chatsRef = useRef<LocalChat[]>([]);
  chatsRef.current = chats;

  const active = chats.find((c) => c.id === activeId) ?? null;
  const messages: UiMessage[] = active?.messages ?? [];
  const isAdmin = isAdminEmail(userEmail);

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  };

  // Stop any voice input/output when leaving the page.
  useEffect(() => {
    return () => {
      recogRef.current?.abort();
      stopSpeaking();
    };
  }, []);

  // Persist guest chats locally — ONLY after the initial load has run.
  // Before this fix this effect ran on mount with chats=[] and overwrote
  // the saved chats with [] before the load effect could read them,
  // so every guest chat vanished on reload.
  useEffect(() => {
    if (!loadedRef.current || userId) return; // logged-in chats live in Supabase
    try {
      localStorage.setItem(GUEST_KEY, JSON.stringify(chats));
    } catch {
      // ignore
    }
  }, [chats, userId]);

  // Remember which guest chat was open, so re-entering restores it.
  useEffect(() => {
    if (!loadedRef.current || userId) return;
    try {
      if (activeId) localStorage.setItem(GUEST_ACTIVE_KEY, activeId);
      else localStorage.removeItem(GUEST_ACTIVE_KEY);
    } catch {
      // ignore
    }
  }, [activeId, userId]);

  // Auth session + load history.
  useEffect(() => {
    const loadGuest = () => {
      const guest = loadGuestChats();
      setChats(guest);
      setActiveId(loadGuestActiveId(guest));
      loadedRef.current = true;
    };
    if (!supabase) {
      loadGuest();
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const session = data.session;
      if (!session?.user) {
        loadGuest();
        return;
      }
      setUserEmail(session.user.email ?? null);
      setUserId(session.user.id);
      setUserName(displayNameOf(session.user));
      const rows: ChatRow[] = await listChats(session.user.id);
      const loaded: LocalChat[] = rows.map((r) => ({
        id: r.id,
        dbId: r.id,
        title: r.title,
        messages: [],
      }));
      setChats(loaded);
      if (loaded.length > 0) setActiveId(loaded[0].id);
      loadedRef.current = true;
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        setUserEmail(session.user.email ?? null);
        setUserId(session.user.id);
        setUserName(displayNameOf(session.user));
      } else {
        // Signed out — go back to the saved guest chats.
        setUserEmail(null);
        setUserId(null);
        setUserName(null);
        if (loadedRef.current) {
          const guest = loadGuestChats();
          setChats(guest);
          setActiveId(loadGuestActiveId(guest));
        }
      }
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
    async (text: string, regenerate = false, baseOverride?: UiMessage[]) => {
      const clean = text.trim();
      if (!clean || streaming) return;
      stopSpeaking();
      let chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
      if (!chat) {
        chat = { id: uid(), title: chatTitleFrom(clean), messages: [] };
        setChats((prev) => [chat!, ...prev]);
        setActiveId(chat.id);
      }
      const chatId = chat.id;

      let history: { role: "user" | "assistant"; content: string; image?: string }[];
      if (regenerate) {
        const base = baseOverride ? [...baseOverride] : [...chat.messages];
        while (base.length > 0 && base[base.length - 1].role === "assistant") base.pop();
        history = base.map((m) => ({ role: m.role, content: m.content, image: m.image }));
        setChats((prev) =>
          prev.map((c) => (c.id === chatId ? { ...c, messages: base } : c))
        );
      } else {
        const userMsg: UiMessage = {
          id: uid(),
          role: "user",
          content: clean,
          image: pendingImage?.dataUrl,
        };
        history = [
          ...chat.messages.map((m) => ({ role: m.role, content: m.content, image: m.image })),
          { role: "user" as const, content: clean, image: pendingImage?.dataUrl },
        ];
        setPendingImage(null);
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
        if (headerMode === "image") {
          // Generated image: JSON body, not a text stream.
          const data = (await res.json()) as { text?: string; image?: string };
          full = data.text ?? "";
          mode = "gemini";
          const image = data.image;
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: full, mode, image }
                        : m
                    ),
                  }
                : c
            )
          );
        } else {
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
    [activeId, streaming, userId, lang, pendingImage]
  );

  const stop = () => abortRef.current?.abort();

  /** Edit your own message: update the text, drop its reply, regenerate. */
  const applyEdit = useCallback(
    async (msgId: string, newText: string) => {
      const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
      if (!chat || streaming) return;
      const idx = chat.messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const edited = chat.messages[idx];
      if (edited.content === newText) return;
      const trailing = chat.messages.slice(idx + 1);
      const newMessages: UiMessage[] = [
        ...chat.messages.slice(0, idx),
        { ...edited, content: newText },
      ];
      setChats((prev) =>
        prev.map((c) => (c.id === chat.id ? { ...c, messages: newMessages } : c))
      );
      if (chat.dbId) {
        await updateMessage(edited.id, newText);
        for (const m of trailing) await deleteMessage(m.id);
      }
      send(newText, true, newMessages);
    },
    [activeId, streaming, send]
  );

  /** Delete your own message — and its assistant reply if it directly follows. */
  const deleteUserMessage = useCallback(
    async (msgId: string) => {
      const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
      if (!chat || streaming) return;
      const idx = chat.messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const end =
        chat.messages[idx + 1]?.role === "assistant" ? idx + 2 : idx + 1;
      const removed = chat.messages.slice(idx, end);
      setChats((prev) =>
        prev.map((c) =>
          c.id === chat.id
            ? {
                ...c,
                messages: [...c.messages.slice(0, idx), ...c.messages.slice(end)],
              }
            : c
        )
      );
      if (chat.dbId) {
        for (const m of removed) await deleteMessage(m.id);
      }
    },
    [activeId, streaming]
  );

  /** Voice input via the free Web Speech API (no key, no paid service). */
  const startListening = useCallback(() => {
    if (listening) {
      recogRef.current?.stop();
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      showNotice(t(lang, "micNotSupported"));
      return;
    }
    const rec = createRecognizer(lang);
    if (!rec) {
      showNotice(t(lang, "micNotSupported"));
      return;
    }
    recogRef.current = rec;
    rec.onresult = (e) => {
      const transcript = Array.from(e.results)
        .filter((r) => r.isFinal)
        .map((r) => r[0].transcript)
        .join(" ")
        .trim();
      if (transcript) {
        setInput((prev) => (prev ? prev + " " + transcript : transcript));
      }
    };
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        showNotice(t(lang, "micPermission"));
      } else if (e.error === "no-speech") {
        showNotice(t(lang, "micNoSpeech"));
      } else {
        showNotice(t(lang, "micNotSupported"));
      }
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      showNotice(t(lang, "micNotSupported"));
    }
  }, [listening, lang]);

  /** Attach a photo: downscale it client-side, show a thumbnail. */
  const onPhotoPicked = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showNotice(t(lang, "errorGeneric"));
      return;
    }
    try {
      const dataUrl = await downscaleImage(file);
      setPendingImage({ dataUrl });
    } catch {
      showNotice(t(lang, "errorGeneric"));
    }
  };

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
    <div className="flex h-dvh w-full flex-col overflow-x-hidden bg-white text-slate-900 dark:bg-[#080D1B] dark:text-[#EAF2FF]">
      {/* ===== Drawer (sidebar as an overlay, like the Android app) ===== */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-black/35"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto bg-white shadow-xl dark:bg-[#0D1426]">
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
                className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
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
        </div>
      )}

      {/* ===== Top bar — exactly like the video ===== */}
      <header className="relative min-w-0 px-3 pt-2 sm:px-5">
        {/* dir="ltr" pins the layout: hamburger LEFT, ••• RIGHT, even in RTL Pashto */}
        <div dir="ltr" className="flex items-start justify-between">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="relative mt-1.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#E3E3E3] bg-white transition-transform active:scale-95 sm:h-14 sm:w-14 dark:border-[#263550] dark:bg-[#111B30]"
            aria-label="Menu"
          >
            <span className="text-2xl leading-none text-[#222222] sm:text-[26px] dark:text-[#EAF2FF]">≡</span>
            <span className="absolute right-1 top-0.5 h-2.5 w-2.5 rounded-full bg-[#2457FF]" />
          </button>
          {/* The avatar is a real button — tapping it opens About. */}
          <Link
            href="/about"
            aria-label={t(lang, "about")}
            className="shrink-0 rounded-full transition-transform active:scale-95"
          >
            <Image
              src="/avatar.jpg"
              alt="Samim AI"
              width={64}
              height={64}
              className="rounded-full object-cover ring-2 ring-white/80 dark:ring-[#263550]"
              priority
            />
          </Link>
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            className="mt-1.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#E3E3E3] bg-white transition-transform active:scale-95 sm:h-14 sm:w-14 dark:border-[#263550] dark:bg-[#111B30]"
            aria-label="More options"
          >
            <span className="text-xl leading-none tracking-[2px] text-[#222222] sm:text-[22px] dark:text-[#EAF2FF]">•••</span>
          </button>
        </div>
        <div className="mt-1.5 flex min-w-0 flex-col items-center">
          <div className="max-w-full rounded-2xl bg-white px-3.5 py-1.5 shadow-md dark:bg-[#111B30] dark:shadow-none dark:ring-1 dark:ring-[#263550]">
            <span className="block truncate text-base text-black dark:text-[#EAF2FF]">
              {/* Logged in: the name pill shows THAT user's name, not the assistant's. */}
              {userName ?? t(lang, "appName")}
              {isAdmin && (
                <span className="ms-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-black">
                  {t(lang, "admin")}
                </span>
              )}
            </span>
          </div>
          <p className="mt-1 text-sm text-[#8A8A8A]">
            {streaming
              ? t(lang, "isWorking")
              : userName
                ? t(lang, "appShort")
                : t(lang, "tagline")}
          </p>
        </div>

        {/* ===== ••• menu ===== */}
        {moreOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-20 cursor-default"
            />
            <div className="absolute right-4 top-full z-30 mt-1 w-56 rounded-2xl border border-[#E3E3E3] bg-white p-2 shadow-lg dark:border-[#263550] dark:bg-[#111B30]">
              <p className="px-2 pb-1 pt-1 text-xs text-slate-500">{t(lang, "language")}</p>
              <div className="flex gap-1 px-1 pb-2">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLang(l.code)}
                    className={`flex-1 rounded-full px-2 py-1.5 text-xs font-bold ${
                      lang === l.code
                        ? "bg-[#2457FF] text-white"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  setTheme(theme === "dark" ? "light" : "dark");
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {theme === "dark" ? "☀ " + t(lang, "light") : "🌙 " + t(lang, "dark")}
              </button>
              <Link
                href="/settings"
                onClick={() => setMoreOpen(false)}
                className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ⚙ {t(lang, "settings")}
              </Link>
              <Link
                href="/about"
                onClick={() => setMoreOpen(false)}
                className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ℹ {t(lang, "about")}
              </Link>
              {isAdmin && (
                <Link
                  href="/admin"
                  onClick={() => setMoreOpen(false)}
                  className="block rounded-xl px-3 py-2 text-sm font-bold text-amber-600 hover:bg-slate-100 dark:text-amber-400 dark:hover:bg-slate-800"
                >
                  ★ {t(lang, "admin")}
                </Link>
              )}
              {userEmail ? (
                <p className="truncate px-3 py-2 text-xs text-slate-500">{userEmail}</p>
              ) : (
                <>
                  <Link
                    href="/login"
                    onClick={() => setMoreOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm font-bold text-[#2457FF] hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t(lang, "login")}
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setMoreOpen(false)}
                    className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {t(lang, "register")}
                  </Link>
                </>
              )}
            </div>
          </>
        )}
      </header>

      {!isSupabaseConfigured && (
        <div className="break-words px-3 py-2 text-center text-[11px] leading-relaxed text-amber-900 sm:text-xs dark:bg-amber-900 dark:text-amber-100 bg-amber-100">
          {t(lang, "setupNeeded")}
        </div>
      )}
      {!userEmail && isSupabaseConfigured && (
        <div className="break-words px-3 py-2 text-center text-[11px] leading-relaxed text-blue-900 sm:text-xs dark:bg-blue-950 dark:text-blue-100 bg-blue-50">
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

      {/* ===== Chat area ===== */}
      <div className="chat-scroll min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-[18px] py-4">
        {/* Sticky timestamp — always fully visible and centred, never clipped. */}
        <div className="sticky top-0 z-10 -mx-[18px] mb-4 bg-white/90 px-[18px] py-1.5 text-center dark:bg-[#080D1B]/90">
          <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-xs text-[#8A8A8A] dark:bg-[#111B30]">
            {chatTime}
          </span>
        </div>
        {messages.length === 0 ? (
          <div className="mx-auto w-full min-w-0 max-w-2xl pb-6 text-center">
            <Link
              href="/about"
              aria-label={t(lang, "about")}
              className="inline-block rounded-full transition-transform active:scale-95"
            >
              <Image
                src="/avatar.jpg"
                alt="Samim AI"
                width={64}
                height={64}
                className="mx-auto rounded-full object-cover ring-2 ring-white/80 dark:ring-[#263550]"
              />
            </Link>
            <div className="mt-3 inline-block max-w-full rounded-2xl bg-white px-3.5 py-1.5 shadow-md dark:bg-[#111B30] dark:shadow-none dark:ring-1 dark:ring-[#263550]">
              <span className="block truncate text-base text-black dark:text-[#EAF2FF]">
                {userName ?? t(lang, "appName")}
              </span>
            </div>
            <h1 className="mt-4 text-xl font-bold">
              {userName
                ? t(lang, "helloName").replace("{name}", userName)
                : t(lang, "welcomeTitle")}
            </h1>
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
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-2.5">
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
                onEditMessage={applyEdit}
                onDeleteMessage={deleteUserMessage}
                onNote={showNotice}
                actionsDisabled={streaming}
              />
            ))}
            {streaming && messages[messages.length - 1]?.content === "" && (
              <div className="flex">
                <div className="mr-auto rounded-[28px] bg-[#EDEEF0] px-[18px] py-1.5 dark:bg-[#111B30]">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ===== Bottom input — like the video ===== */}
      <div className="min-w-0 w-full px-2.5 pb-2.5 pt-1 sm:px-3.5">
        {notice && (
          <p className="mx-auto mb-2 max-w-3xl rounded-full bg-slate-900 px-4 py-2 text-center text-xs text-white dark:bg-slate-100 dark:text-slate-900">
            {notice}
          </p>
        )}
        {listening && (
          <p className="mx-auto mb-2 max-w-3xl text-center text-xs font-bold text-red-500">
            🎙 {t(lang, "listening")}
          </p>
        )}
        {pendingImage && (
          <div className="mx-auto mb-2 flex max-w-3xl items-start gap-2">
            <img
              src={pendingImage.dataUrl}
              alt=""
              className="max-h-28 rounded-2xl object-cover"
            />
            <button
              type="button"
              onClick={() => setPendingImage(null)}
              className="rounded-full bg-slate-200 px-2 py-1 text-xs dark:bg-slate-800"
              aria-label={t(lang, "close")}
            >
              ✕
            </button>
          </div>
        )}
        <form
          dir="ltr"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
            setInput("");
          }}
          className="mx-auto flex w-full min-w-0 max-w-3xl items-center gap-2 sm:gap-2.5"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Attach photo"
            onChange={(e) => {
              onPhotoPicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex min-h-12 min-w-0 flex-1 items-center rounded-[32px] bg-[#F0F0F0] px-2 sm:min-h-14 sm:px-3 dark:bg-[#111B30]">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="shrink-0 px-1 text-2xl leading-none text-[#111111] sm:text-[26px] dark:text-[#EAF2FF]"
              aria-label="+"
            >
              ＋
            </button>
            <input
              dir="auto"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t(lang, "askPlaceholder")}
              className="bidi-plaintext min-w-0 flex-1 bg-transparent px-2 py-1 text-base text-[#111111] outline-none placeholder:text-[#9A9A9A] sm:text-[17px] dark:text-[#EAF2FF]"
            />
            <button
              type="button"
              onClick={startListening}
              className={`shrink-0 rounded-full px-1 text-xl leading-none sm:text-[22px] ${
                listening ? "mic-listening text-red-500" : ""
              }`}
              aria-label="Microphone"
            >
              🎙
            </button>
          </div>
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white transition-transform active:scale-95 sm:h-12 sm:w-12 dark:bg-white dark:text-black"
              aria-label={t(lang, "stop")}
            >
              <span className="text-base leading-none sm:text-lg">■</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white transition-transform disabled:bg-[#B9B9B9] active:scale-95 sm:h-12 sm:w-12 dark:bg-white dark:text-black dark:disabled:bg-[#334155]"
              aria-label={t(lang, "send")}
            >
              <span className="text-xl leading-none sm:text-2xl">↑</span>
            </button>
          )}
        </form>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Samim AI • {t(lang, "notMuse")}
        </p>
      </div>
    </div>
  );
}
