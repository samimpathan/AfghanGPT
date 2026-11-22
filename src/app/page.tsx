"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import ChatMessage, { type UiMessage } from "@/components/ChatMessage";
import LiveCall from "@/components/LiveCall";
import { useUi } from "@/components/Providers";
import { t, LANGS } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { isAdminEmail } from "@/lib/admin";
import { store } from "@/lib/store";
import { providerInfos, type ProviderId } from "@/lib/providers";
import { downloadFileSpec } from "@/lib/client";
import type { FileSpec } from "@/lib/filegen";
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
  isMediaRecorderSupported,
  transcribeRecording,
  stopSpeaking,
  type SpeechRecognitionInstance,
} from "@/lib/voice";

type LocalChat = {
  id: string;
  title: string;
  dbId?: string;
  messages: UiMessage[];
};

type ModelMode = "auto" | "fast" | "smart";

const MODEL_KEY = "samim-ai-model";
const SAVED_IMAGES_KEY = "samim-ai-saved-images";
const META_KEY = "samim-ai-chat-meta";

/** GUEST PRIVACY (2026-11-22): guest chats are IN-MEMORY ONLY.
 * There is deliberately NO guest-chat storage key anymore — no
 * localStorage, no sessionStorage, no IndexedDB, no Supabase.
 * A guest chat starts empty on every mount and dies on refresh,
 * page close, or sign-out. Logged-in chats live in Supabase. */

/** Chat folders + archive live in localStorage, keyed by chat id.
 * Deliberately NOT a database column: studio-001.sql is additive
 * new tables only, and folders are per-device organisation. */
type ChatMeta = { folder?: string; archived?: boolean };

function loadChatMeta(): Record<string, ChatMeta> {
  try {
    const raw = localStorage.getItem(META_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, ChatMeta>) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The 8 merged studios (from the Samim AI studios). */
const STUDIOS = [
  { href: "/studio/write", key: "writing", icon: "✍", feature: "writing" },
  { href: "/studio/code", key: "coding", icon: "</>", feature: "coding" },
  { href: "/studio/builder", key: "builder", icon: "🧩", feature: "builder" },
  { href: "/studio/image", key: "image", icon: "🖼", feature: "image" },
  { href: "/studio/slides", key: "slides", icon: "📊", feature: "slides" },
  { href: "/studio/docs", key: "docs", icon: "📄", feature: "docs" },
  { href: "/research", key: "research", icon: "🔍", feature: "research" },
  { href: "/studio/workflows", key: "workflows", icon: "⚙", feature: "workflows" },
] as const;
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

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

/** Pins are IN-MEMORY ONLY (guest-privacy rule): a pinned guest
 * chat must not survive a refresh, so pins are never written to
 * any storage — they live in state for this session only. */
function loadSavedImages(): string[] {
  try {
    const raw = localStorage.getItem(SAVED_IMAGES_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelMode, setModelMode] = useState<ModelMode>("auto");
  const [notice, setNotice] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string } | null>(null);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pins, setPins] = useState<string[]>([]);
  const [savedImages, setSavedImages] = useState<string[]>([]);
  const [plusOpen, setPlusOpen] = useState(false);
  const [thinkHarder, setThinkHarder] = useState(false);
  const [liveCallOpen, setLiveCallOpen] = useState(false);
  const [screenShareOpen, setScreenShareOpen] = useState(false);
  // Merged studios + master-prompt features (v3.3).
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [serverGemini, setServerGemini] = useState(true);
  const [tempMode, setTempMode] = useState(false);
  const [chatMeta, setChatMeta] = useState<Record<string, ChatMeta>>({});
  const [drawerCollapsed, setDrawerCollapsed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [studioFeatures, setStudioFeatures] = useState<Record<string, boolean>>({});
  // Temporary chats are never saved anywhere — not Supabase, not
  // localStorage. Their ids live only in this ref for this session.
  const tempIdsRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const recogRef = useRef<SpeechRecognitionInstance | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatsRef = useRef<LocalChat[]>([]);
  chatsRef.current = chats;

  const active = chats.find((c) => c.id === activeId) ?? null;
  const messages: UiMessage[] = active?.messages ?? [];
  const isAdmin = isAdminEmail(userEmail);
  const isPinned = activeId ? pins.includes(activeId) : false;

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  // Stop any voice input/output when leaving the page.
  useEffect(() => {
    return () => {
      recogRef.current?.abort();
      recorderRef.current?.stop();
      stopSpeaking();
    };
  }, []);

  // Load the saved model choice + pins once.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY) as ModelMode | null;
      if (saved === "fast" || saved === "smart" || saved === "auto") setModelMode(saved);
      const settings = store.settings();
      if (settings.provider) setProvider(settings.provider);
    } catch {
      // ignore
    }
    // Pins are in-memory only — never loaded from storage.
    setChatMeta(loadChatMeta());
    // Honest provider status: Gemini is ready only when the server says so.
    fetch("/api/status")
      .then((r) => r.json() as Promise<{ geminiConfigured?: boolean }>)
      .then((j) => setServerGemini(!!j.geminiConfigured))
      .catch(() => setServerGemini(false));
  }, []);

  // Persist chat folders + archive flags — LOGGED-IN ONLY.
  // Guests get in-session folders only; nothing is written, so a
  // guest's folders die with the session like their chats.
  useEffect(() => {
    if (!userId) return;
    try {
      localStorage.setItem(META_KEY, JSON.stringify(chatMeta));
    } catch {
      // ignore
    }
  }, [chatMeta, userId]);

  // Refresh the saved-images gallery whenever the drawer opens.
  useEffect(() => {
    if (sidebarOpen) {
      setSavedImages(loadSavedImages());
      try {
        setStudioFeatures(store.settings().features ?? {});
      } catch {
        // ignore
      }
    }
  }, [sidebarOpen]);

  // Auth session + load history.
  useEffect(() => {
    // Guests start EMPTY every time — in-memory only, nothing to load.
    const loadGuest = () => {
      setChats([]);
      setActiveId(null);
      store.setMemoryOnly(true);
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
      store.setMemoryOnly(false);
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
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        store.setMemoryOnly(false);
        setUserEmail(session.user.email ?? null);
        setUserId(session.user.id);
        setUserName(displayNameOf(session.user));
      } else {
        // Signed out — the guest session starts empty. Nothing from
        // the signed-in session (or any earlier guest session) is kept.
        store.setMemoryOnly(true);
        setUserEmail(null);
        setUserId(null);
        setUserName(null);
        setChats([]);
        setActiveId(null);
        setPins([]);
        setChatMeta({});
        tempIdsRef.current.clear();
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const lastMessageContent = messages[messages.length - 1]?.content ?? "";
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, lastMessageContent]);

  // Auto-growing composer (ChatGPT-style): the textarea grows with
  // the text up to 4 lines (~120px), then scrolls internally. The
  // bar grows upward; the chat area above shrinks to make room.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, [input]);

  const newChat = useCallback(() => {
    const c: LocalChat = { id: uid(), title: t(lang, "newChat"), messages: [] };
    if (tempMode) tempIdsRef.current.add(c.id);
    setChats((prev) => [c, ...prev]);
    setActiveId(c.id);
    setSidebarOpen(false);
    setMoreOpen(false);
  }, [lang, tempMode]);

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

  const pickModel = (m: ModelMode) => {
    setModelMode(m);
    setModelPickerOpen(false);
    try {
      localStorage.setItem(MODEL_KEY, m);
    } catch {
      // ignore
    }
  };

  /** Provider options for the ••• menu (statuses are honest: a
   * provider is "ready" only when its key is actually configured). */
  const providerOptions = (() => {
    try {
      const s = store.settings();
      return providerInfos({
        geminiConfigured: serverGemini,
        openaiKey: !!s.openaiKey.trim(),
        anthropicKey: !!s.anthropicKey.trim(),
        deepseekKey: !!s.deepseekKey.trim(),
        grokKey: !!s.grokKey.trim(),
        qwenKey: !!s.qwenKey.trim(),
        openRouterKey: !!s.openRouterKey.trim(),
        huggingFaceKey: !!s.hfKey.trim(),
      });
    } catch {
      return [];
    }
  })();

  const pickProvider = (id: ProviderId) => {
    setProvider(id);
    try {
      const s = store.settings();
      store.saveSettings({ ...s, provider: id });
    } catch {
      // ignore
    }
  };

  // Pins are in-memory only — never written to any storage.
  const togglePin = useCallback((id: string) => {
    setPins((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [id, ...prev]
    );
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

      // Temporary chat mode: this chat is never saved anywhere.
      if (tempMode) tempIdsRef.current.add(chatId);

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
      // Temporary chats never get a database row.
      let dbId = chat.dbId;
      if (userId && supabase && !dbId && !tempIdsRef.current.has(chatId)) {
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
      // "Think harder" sends this one message as Smart, whatever the picker says.
      const mode: ModelMode = thinkHarder ? "smart" : modelMode;
      let full = "";
      let replyMode: UiMessage["mode"] = "offline";
      let replyProvider: string | undefined;
      // Conversation memory: the user's own facts, only when enabled
      // in Settings. Sent as a system prompt; never stored server-side.
      let memorySystem = "";
      try {
        const s = store.settings();
        if (s.memoryEnabled && s.memoryFacts.length > 0) {
          memorySystem =
            "Remember these facts about the user (from their Memory setting):\n" +
            s.memoryFacts.map((f) => `- ${f}`).join("\n");
        }
      } catch {
        // ignore
      }
      // Optional provider (Settings → Providers): when the user picked
      // a provider other than Gemini and supplied its key, try it first.
      // On any failure we fall back to Gemini below and say so.
      let providerDone = false;
      try {
        const s = store.settings();
        const chosen = s.provider ?? "gemini";
        if (chosen !== "gemini") {
          const infos = providerInfos({
            geminiConfigured: serverGemini,
            openaiKey: !!s.openaiKey.trim(),
            anthropicKey: !!s.anthropicKey.trim(),
            deepseekKey: !!s.deepseekKey.trim(),
            grokKey: !!s.grokKey.trim(),
            qwenKey: !!s.qwenKey.trim(),
            openRouterKey: !!s.openRouterKey.trim(),
            huggingFaceKey: !!s.hfKey.trim(),
          });
          const info = infos.find((p) => p.id === chosen);
          const key = info?.keyField ? s[info.keyField] : "";
          if (info && key) {
            const pres = await fetch("/api/providers", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: chosen,
                key,
                messages: history,
                model: info.defaultModel,
                system: memorySystem,
              }),
              signal: controller.signal,
            });
            if (!pres.ok) throw new Error("provider failed");
            const pdata = (await pres.json()) as { text?: string };
            full = pdata.text ?? "";
            if (!full.trim()) throw new Error("provider empty");
            replyMode = "provider";
            replyProvider = info.name;
            providerDone = true;
            setChats((prev) =>
              prev.map((c) =>
                c.id === chatId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantId
                          ? { ...m, content: full, mode: replyMode, provider: replyProvider }
                          : m
                      ),
                    }
                  : c
              )
            );
          }
        }
      } catch (e) {
        if (!(e instanceof Error && e.name === "AbortError")) {
          showNotice(t(lang, "providerFallback"));
        }
        providerDone = false;
      }
      try {
        if (!providerDone) {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history, mode, system: memorySystem }),
          signal: controller.signal,
        });
        const headerMode = res.headers.get("X-SamimAI-Mode");
        if (
          headerMode === "gemini" ||
          headerMode === "offline" ||
          headerMode === "refused" ||
          headerMode === "busy" ||
          headerMode === "file"
        ) {
          replyMode = headerMode;
        }
        if (!res.ok || !res.body) throw new Error("API error");
        if (headerMode === "image") {
          // Generated image: JSON body, not a text stream.
          const data = (await res.json()) as { text?: string; image?: string };
          full = data.text ?? "";
          replyMode = "gemini";
          const image = data.image;
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: full, mode: replyMode, image }
                        : m
                    ),
                  }
                : c
            )
          );
        } else if (headerMode === "file") {
          // Generated file: JSON body with a base64 file + summary text.
          const data = (await res.json()) as {
            text?: string;
            file?: { filename: string; mime: string; size: number; base64: string };
          };
          full = data.text ?? "";
          replyMode = "file";
          setChats((prev) =>
            prev.map((c) =>
              c.id === chatId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: full, mode: replyMode, file: data.file }
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
                        m.id === assistantId ? { ...m, content: snapshot, mode: replyMode } : m
                      ),
                    }
                  : c
              )
            );
          }
        }
        } // end if (!providerDone) — provider replies skip the Gemini fetch
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
                      m.id === assistantId ? { ...m, content: full, mode: replyMode } : m
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
    [activeId, streaming, userId, lang, pendingImage, modelMode, thinkHarder, serverGemini, tempMode]
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

  /** Branch in new chat: duplicate this chat from a message into a new chat. */
  const branchFromMessage = useCallback(
    async (msgId: string) => {
      const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
      if (!chat || streaming) return;
      const idx = chat.messages.findIndex((m) => m.id === msgId);
      if (idx < 0) return;
      const branched: UiMessage[] = chat.messages.slice(0, idx + 1).map((m) => ({ ...m, id: uid() }));
      const newC: LocalChat = { id: uid(), title: chat.title, messages: branched };
      if (tempIdsRef.current.has(chat.id)) tempIdsRef.current.add(newC.id);
      setChats((prev) => [newC, ...prev]);
      setActiveId(newC.id);
      showNotice(t(lang, "chatBranched"));
      // Logged-in: also save the branched chat to Supabase (best effort).
      // Temporary chats never get a database row.
      if (userId && supabase && !tempIdsRef.current.has(newC.id)) {
        const row = await createChat(userId, chat.title);
        if (row) {
          setChats((prev) =>
            prev.map((c) => (c.id === newC.id ? { ...c, dbId: row.id } : c))
          );
          for (const m of branched) await saveMessage(row.id, m.role, m.content);
        }
      }
    },
    [activeId, streaming, lang, userId]
  );

  /** Export the active chat as a .md download. */
  const exportChat = useCallback(() => {
    const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
    if (!chat) return;
    const lines = [`# ${chat.title}`, ""];
    for (const m of chat.messages) {
      lines.push(m.role === "user" ? `**You:** ${m.content}` : `**Samim AI:** ${m.content}`);
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown; charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${chat.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "samim-ai-chat"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showNotice(t(lang, "chatExported"));
  }, [activeId, lang]);

  /** Export the active chat as a real PDF file (via /api/files). */
  const exportChatPdf = useCallback(async () => {
    const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
    if (!chat) return;
    const lines: string[] = [chat.title, ""];
    for (const m of chat.messages) {
      lines.push(`${m.role === "user" ? "You" : "Samim AI"}: ${m.content}`);
    }
    const spec: FileSpec = {
      type: "pdf",
      filename: `${chat.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "samim-ai-chat"}.pdf`,
      pdf: { title: chat.title, lines },
    };
    try {
      await downloadFileSpec(spec);
      showNotice(t(lang, "chatExported"));
    } catch {
      showNotice(t(lang, "errorGeneric"));
    }
  }, [activeId, lang]);

  /** Export the active chat as a real Word document (via /api/files). */
  const exportChatDocx = useCallback(async () => {
    const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
    if (!chat) return;
    const spec: FileSpec = {
      type: "docx",
      filename: `${chat.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "samim-ai-chat"}.docx`,
      docx: {
        title: chat.title,
        sections: [
          {
            heading: chat.title,
            paragraphs: chat.messages.map(
              (m) => `${m.role === "user" ? "You" : "Samim AI"}: ${m.content}`
            ),
          },
        ],
      },
    };
    try {
      await downloadFileSpec(spec);
      showNotice(t(lang, "chatExported"));
    } catch {
      showNotice(t(lang, "errorGeneric"));
    }
  }, [activeId, lang]);

  /** Share via a public read-only link — ONLY after the user confirms.
   * The chat is saved to the shared_chats table (needs studio-001.sql
   * run + a login). If that is unavailable, the chat is downloaded as
   * .md instead and the user is told so — never a fake link. */
  const shareLink = useCallback(async () => {
    const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
    if (!chat || chat.messages.length === 0) return;
    if (!window.confirm(t(lang, "shareConfirm"))) return;
    if (supabase && userId) {
      const { data, error } = await supabase
        .from("shared_chats")
        .insert({
          owner_id: userId,
          title: chat.title,
          messages: chat.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        })
        .select("id")
        .single();
      if (!error && data) {
        const url = `${window.location.origin}/share/${(data as { id: string }).id}`;
        try {
          await navigator.clipboard.writeText(url);
          showNotice(t(lang, "shareLinkCopied"));
        } catch {
          showNotice(url);
        }
        return;
      }
    }
    // Sharing is not set up (no login / migration not run yet).
    exportChat();
    showNotice(t(lang, "shareUnavailable"));
  }, [activeId, lang, userId, exportChat]);

  /** Chat folders + archive (per device, localStorage only). */
  const setFolder = useCallback((id: string, folder: string) => {
    setChatMeta((prev) => {
      const next = { ...prev };
      const cur = next[id] ?? {};
      if (!folder && !cur.archived) {
        delete next[id];
      } else if (!folder) {
        next[id] = { archived: cur.archived };
      } else {
        next[id] = { ...cur, folder };
      }
      return next;
    });
  }, []);

  const toggleArchive = useCallback((id: string) => {
    setChatMeta((prev) => {
      const cur = prev[id] ?? {};
      return { ...prev, [id]: { ...cur, archived: !cur.archived } };
    });
  }, []);

  /** Share the active conversation (Web Share API, clipboard fallback). */
  const shareChat = useCallback(async () => {
    const chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
    if (!chat) return;
    const text = [`${chat.title}`, ""];
    for (const m of chat.messages) {
      text.push(`${m.role === "user" ? "You" : "Samim AI"}: ${m.content}`);
    }
    const joined = text.join("\n");
    try {
      if (navigator.share) {
        await navigator.share({ title: chat.title, text: joined });
        return;
      }
      throw new Error("no share");
    } catch {
      try {
        await navigator.clipboard.writeText(joined);
        showNotice(t(lang, "chatShared"));
      } catch {
        // ignore
      }
    }
  }, [activeId, lang]);

  /** Voice input — v3.2 fix.
   * English: the Web Speech API fast path (Chrome supports en-US).
   * Pashto/Dari: Chrome has no SpeechRecognition for ps-AF/fa-IR, so
   * record with MediaRecorder and transcribe with Gemini
   * (/api/transcribe); the transcript lands in the input box for the
   * user to check and send. Offline (no key) -> honest note. */
  const startListening = useCallback(() => {
    if (listening || recording) {
      recogRef.current?.stop();
      recorderRef.current?.stop();
      return;
    }
    if (lang === "en" && isSpeechRecognitionSupported()) {
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
      return;
    }
    // Recorder + Gemini path (Pashto/Dari, or no SpeechRecognition).
    if (!isMediaRecorderSupported()) {
      showNotice(t(lang, "micNotSupported"));
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const rec = new MediaRecorder(stream);
        recorderRef.current = rec;
        recorderChunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size > 0) recorderChunksRef.current.push(e.data);
        };
        rec.onstop = async () => {
          stream.getTracks().forEach((tr) => tr.stop());
          setRecording(false);
          const blob = new Blob(recorderChunksRef.current, {
            type: rec.mimeType || "audio/webm",
          });
          if (blob.size === 0) {
            showNotice(t(lang, "micNoSpeech"));
            return;
          }
          showNotice(t(lang, "voiceTranscribing"));
          try {
            const text = await transcribeRecording(blob);
            if (text) setInput((prev) => (prev ? prev + " " + text : text));
            else showNotice(t(lang, "micNoSpeech"));
          } catch (e) {
            if (e instanceof Error && (e as Error & { code?: string }).code === "no-key") {
              showNotice(t(lang, "voiceNeedsOnline"));
            } else {
              showNotice(t(lang, "errorGeneric"));
            }
          }
        };
        rec.start();
        setRecording(true);
      })
      .catch(() => showNotice(t(lang, "micPermission")));
  }, [listening, recording, lang]);

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

  /** A text file: read its text straight into the input box. */
  const onTextFilePicked = async (file: File | undefined) => {
    if (!file) return;
    if (file.type.startsWith("image/")) {
      await onPhotoPicked(file);
      return;
    }
    if (
      file.type.startsWith("text/") ||
      /\.(txt|md|csv|json|html|css|js|ts|py|cpp|java)$/i.test(file.name)
    ) {
      try {
        const text = await file.text();
        setInput((prev) => (prev ? prev + "\n" + text.slice(0, 5000) : text.slice(0, 5000)));
      } catch {
        showNotice(t(lang, "errorGeneric"));
      }
      return;
    }
    showNotice(t(lang, "fileNotSupported"));
  };

  /** Screen share (outside a call): capture the screen, show a
   * preview, and let the user send ONE still frame to the AI as a
   * photo question. No live call is pretended — there is no peer. */
  const openScreenShare = async () => {
    setPlusOpen(false);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenShareOpen(true);
      stream.getVideoTracks()[0]?.addEventListener("ended", closeScreenShare);
    } catch {
      showNotice(t(lang, "screenShareBlocked"));
    }
  };

  const closeScreenShare = () => {
    screenStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    screenStreamRef.current = null;
    setScreenShareOpen(false);
  };

  const sendScreenFrame = () => {
    const video = screenVideoRef.current;
    if (!video || video.videoWidth === 0) {
      showNotice(t(lang, "errorGeneric"));
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      showNotice(t(lang, "errorGeneric"));
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    setPendingImage({ dataUrl: canvas.toDataURL("image/jpeg", 0.8) });
    closeScreenShare();
    showNotice(t(lang, "screenShareSend"));
  };

  // Attach the screen-share stream to the preview element.
  useEffect(() => {
    const el = screenVideoRef.current;
    if (el && screenStreamRef.current) el.srcObject = screenStreamRef.current;
  }, [screenShareOpen]);

  /** A live call's transcript joins the current chat when it ends. */
  const onLiveCallClose = useCallback(
    async (lines: { role: "user" | "assistant"; text: string }[]) => {
      setLiveCallOpen(false);
      if (lines.length === 0) return;
      let chat = chatsRef.current.find((c) => c.id === activeId) ?? null;
      if (!chat) {
        chat = { id: uid(), title: chatTitleFrom(lines[0].text), messages: [] };
        setChats((prev) => [chat!, ...prev]);
        setActiveId(chat.id);
      }
      const chatId = chat.id;
      const newMsgs: UiMessage[] = lines.map((l) => ({ id: uid(), role: l.role, content: l.text }));
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId ? { ...c, messages: [...c.messages, ...newMsgs] } : c
        )
      );
      if (chat.dbId) {
        for (const m of newMsgs) await saveMessage(chat.dbId, m.role, m.content);
      }
    },
    [activeId]
  );

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
    setPins((prev) => prev.filter((p) => p !== id));
    setChatMeta((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    tempIdsRef.current.delete(id);
    setMoreOpen(false);
    if (chat?.dbId) await deleteChatDb(chat.dbId);
  };

  const isArchived = (id: string) => !!chatMeta[id]?.archived;
  const folderOf = (id: string) => chatMeta[id]?.folder ?? "";
  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase())
  );
  const visibleChats = filtered.filter((c) => !isArchived(c.id));
  const archivedChats = filtered.filter((c) => isArchived(c.id));
  const pinnedChats = visibleChats.filter((c) => pins.includes(c.id));
  const otherChats = visibleChats.filter((c) => !pins.includes(c.id));
  const folders = Array.from(new Set(otherChats.map((c) => folderOf(c.id)).filter(Boolean))).sort();
  const unfiledChats = otherChats.filter((c) => !folderOf(c.id));
  const visibleStudios = STUDIOS.filter((s) => studioFeatures[s.feature] !== false);

  const modelLabel =
    modelMode === "fast" ? t(lang, "modelFast") : modelMode === "smart" ? t(lang, "modelSmart") : t(lang, "modelAuto");

  const suggestions = [
    t(lang, "suggestion1"),
    t(lang, "suggestion2"),
    t(lang, "suggestion3"),
    t(lang, "suggestion4"),
  ];

  const chatItem = (c: LocalChat) => (
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
          {pins.includes(c.id) ? "📌 " : ""}
          {c.title}
        </button>
      )}
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
        <button type="button" onClick={() => togglePin(c.id)}>
          {pins.includes(c.id) ? t(lang, "unpinChat") : t(lang, "pinChat")}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditingId(c.id);
            setEditingTitle(c.title);
          }}
        >
          {t(lang, "rename")}
        </button>
        <button type="button" onClick={() => toggleArchive(c.id)}>
          {isArchived(c.id) ? t(lang, "restore") : t(lang, "archive")}
        </button>
        <select
          value={folderOf(c.id)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new__") {
              const name = window.prompt(t(lang, "newFolder"), "");
              if (name?.trim()) setFolder(c.id, name.trim().slice(0, 40));
            } else {
              setFolder(c.id, v);
            }
          }}
          className="max-w-[110px] truncate rounded border border-slate-300 bg-transparent px-1 py-0.5 text-xs dark:border-slate-700"
          aria-label={t(lang, "moveToFolder")}
        >
          <option value="">{t(lang, "noFolder")}</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value="__new__">+ {t(lang, "newFolder")}</option>
        </select>
        <button type="button" onClick={() => doDelete(c.id)} className="text-red-500">
          {t(lang, "delete")}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh w-full flex-col overflow-x-hidden bg-white text-slate-900 dark:bg-[#080D1B] dark:text-[#EAF2FF]">
      {/* ===== Drawer (ChatGPT style, RTL-aware) ===== */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
            className="absolute inset-0 bg-black/35"
          />
          <aside
            className={`absolute inset-y-0 left-0 flex flex-col overflow-y-auto bg-white shadow-xl dark:bg-[#0D1426] ${
              drawerCollapsed ? "w-16" : "w-72"
            }`}
          >
            {drawerCollapsed ? (
              <div className="flex flex-col items-center gap-2 py-3">
                <button
                  type="button"
                  onClick={() => setDrawerCollapsed(false)}
                  className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                  aria-label={t(lang, "expand")}
                >
                  »
                </button>
                <button
                  type="button"
                  onClick={newChat}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2457FF] text-lg font-bold text-white"
                  aria-label={t(lang, "newChat")}
                >
                  +
                </button>
                {visibleStudios.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    onClick={() => setSidebarOpen(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label={t(lang, s.key)}
                  >
                    {s.icon}
                  </Link>
                ))}
                <Link
                  href="/settings"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-lg hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label={t(lang, "settings")}
                >
                  ⚙
                </Link>
              </div>
            ) : (
              <>
            <div className="flex items-center gap-2 p-3">
              {/* AVATAR FIX (v3.2): a plain <a href="/about"> — not a
                  framework Link — so the tap works on any phone. The
                  /about page itself renders fine; nothing overlays
                  this anchor (the only fixed overlays render when a
                  menu is open, and they close on tap). */}
              <a
                href="/about"
                aria-label={t(lang, "about")}
                className="pointer-events-auto relative z-10 shrink-0 cursor-pointer rounded-full transition-transform active:scale-90"
              >
                <Image
                  src="/avatar.jpg"
                  alt="Samim AI"
                  width={40}
                  height={40}
                  className="rounded-full object-cover"
                />
              </a>
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
                onClick={() => setDrawerCollapsed(true)}
                className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                aria-label={t(lang, "collapse")}
              >
                «
              </button>
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
            {/* Studios (merged from the Samim AI studios) */}
            <div className="px-3 pb-1 pt-2">
              <p className="px-1 pb-1 text-xs font-bold text-slate-500">
                🎨 {t(lang, "studios")}
              </p>
              <div className="flex flex-col gap-0.5">
                {visibleStudios.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    onClick={() => setSidebarOpen(false)}
                    className="rounded-lg px-2 py-1.5 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    {s.icon} {t(lang, s.key)}
                  </Link>
                ))}
              </div>
            </div>
            {!userEmail && (
              <p className="mx-3 mb-1 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t(lang, "guestNotice")}{" "}
                <Link href="/login" className="font-bold underline">
                  {t(lang, "login")}
                </Link>
              </p>
            )}
            <div className="chat-scroll mt-2 flex-1 overflow-y-auto px-2 pb-2">
              {savedImages.length > 0 && (
                <div className="mb-2">
                  <p className="px-2 pb-1 pt-1 text-xs font-bold text-slate-500">
                    {t(lang, "images")}
                  </p>
                  <div className="grid grid-cols-3 gap-1 px-1">
                    {savedImages.slice(0, 9).map((src, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => {
                          setPendingImage({ dataUrl: src });
                          setSidebarOpen(false);
                        }}
                        className="overflow-hidden rounded-lg"
                        aria-label={t(lang, "images")}
                      >
                        <img src={src} alt="" className="h-16 w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {pinnedChats.length > 0 && (
                <div className="mb-1">
                  <p className="px-2 pb-1 pt-1 text-xs font-bold text-slate-500">
                    📌 {t(lang, "pinned")}
                  </p>
                  {pinnedChats.map(chatItem)}
                </div>
              )}
              {filtered.length === 0 && (
                <p className="px-2 py-4 text-center text-sm text-slate-500">
                  {t(lang, "noChats")}
                </p>
              )}
              {folders.map((f) => (
                <div key={f} className="mb-1">
                  <p className="px-2 pb-1 pt-1 text-xs font-bold text-slate-500">
                    📁 {f}
                  </p>
                  {otherChats.filter((c) => folderOf(c.id) === f).map(chatItem)}
                </div>
              ))}
              {unfiledChats.map(chatItem)}
              {folders.length > 0 && (
                <p className="px-2 pb-1 text-[11px] text-slate-400">
                  {t(lang, "foldersLocalNote")}
                </p>
              )}
              {archivedChats.length > 0 && (
                <div className="mb-1">
                  <button
                    type="button"
                    onClick={() => setShowArchived((v) => !v)}
                    className="w-full px-2 pb-1 pt-1 text-start text-xs font-bold text-slate-500"
                  >
                    🗄 {t(lang, "archived")} ({archivedChats.length}){" "}
                    {showArchived ? "▾" : "▸"}
                  </button>
                  {showArchived && archivedChats.map(chatItem)}
                </div>
              )}
            </div>
            <div className="border-t border-slate-200 p-3 dark:border-slate-800">
              {userEmail ? (
                <a href="/about" className="flex items-center gap-2">
                  <Image
                    src="/avatar.jpg"
                    alt="Samim AI"
                    width={32}
                    height={32}
                    className="rounded-full object-cover"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-bold">
                    {userName ?? userEmail}
                  </span>
                </a>
              ) : (
                <Link href="/login" className="text-sm font-bold text-[#2457FF] hover:underline">
                  {t(lang, "login")}
                </Link>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
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
              </div>
              <p className="mt-2 text-xs text-slate-400">{t(lang, "notMuse")}</p>
            </div>
              </>
            )}
          </aside>
        </div>
      )}

      {/* ===== Header: hamburger | model picker | avatar + new chat + ••• ===== */}
      <header className="relative min-w-0 px-3 pt-2 sm:px-5">
        <div dir="ltr" className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E3E3E3] bg-white transition-transform active:scale-95 sm:h-12 sm:w-12 dark:border-[#263550] dark:bg-[#111B30]"
            aria-label="Menu"
          >
            <span className="text-2xl leading-none text-[#222222] dark:text-[#EAF2FF]">≡</span>
            <span className="absolute right-1 top-0.5 h-2.5 w-2.5 rounded-full bg-[#2457FF]" />
          </button>

          {/* Model picker (centre) */}
          <div className="relative min-w-0 flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => setModelPickerOpen((v) => !v)}
              className="flex max-w-full items-center gap-1 rounded-full px-3 py-2 text-base font-bold transition-transform active:scale-95"
              aria-label={t(lang, "modelPicker")}
            >
              <span className="truncate">{modelLabel}</span>
              <span className="text-xs text-slate-500">▾</span>
            </button>
            {modelPickerOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setModelPickerOpen(false)}
                  className="fixed inset-0 z-20 cursor-default"
                />
                <div className="absolute left-1/2 top-full z-30 mt-1 w-56 -translate-x-1/2 rounded-2xl border border-[#E3E3E3] bg-white p-2 shadow-lg dark:border-[#263550] dark:bg-[#111B30]">
                  {(["auto", "fast", "smart"] as ModelMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => pickModel(m)}
                      className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      {m === "auto"
                        ? t(lang, "modelAuto")
                        : m === "fast"
                          ? t(lang, "modelFast")
                          : t(lang, "modelSmart")}
                      {modelMode === m ? " ✓" : ""}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div dir="ltr" className="flex shrink-0 items-center gap-1.5">
            {/* AVATAR FIX (v3.2): plain <a href="/about">, pointer-events
                auto, z-10, real tap target — the user reported the
                header avatar did nothing. Verified: /about renders,
                and no element covers this anchor in the new header
                (the ••• overlay only exists while its menu is open). */}
            <a
              href="/about"
              aria-label={t(lang, "about")}
              className="pointer-events-auto relative z-10 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform active:scale-90 sm:h-12 sm:w-12"
            >
              <Image
                src="/avatar.jpg"
                alt="Samim AI"
                width={44}
                height={44}
                className="rounded-full object-cover ring-2 ring-white/80 dark:ring-[#263550]"
                priority
              />
            </a>
            <button
              type="button"
              onClick={newChat}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E3E3E3] bg-white text-xl transition-transform active:scale-95 sm:h-12 sm:w-12 dark:border-[#263550] dark:bg-[#111B30]"
              aria-label={t(lang, "newChat")}
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E3E3E3] bg-white transition-transform active:scale-95 sm:h-12 sm:w-12 dark:border-[#263550] dark:bg-[#111B30]"
              aria-label="More options"
            >
              <span className="text-xl leading-none tracking-[2px] text-[#222222] dark:text-[#EAF2FF]">•••</span>
            </button>
          </div>
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
            <div className="absolute right-4 top-full z-30 mt-1 w-60 rounded-2xl border border-[#E3E3E3] bg-white p-2 shadow-lg dark:border-[#263550] dark:bg-[#111B30]">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  void shareChat();
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ↗ {t(lang, "shareChat")}
              </button>
              <button
                type="button"
                disabled={!activeId}
                onClick={() => {
                  if (activeId) togglePin(activeId);
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                📌 {isPinned ? t(lang, "unpinChat") : t(lang, "pinChat")}
              </button>
              <button
                type="button"
                disabled={!activeId}
                onClick={() => {
                  if (active) {
                    setEditingId(active.id);
                    setEditingTitle(active.title);
                    setSidebarOpen(true);
                  }
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                ✎ {t(lang, "rename")}
              </button>
              <Link
                href="/about"
                onClick={() => setMoreOpen(false)}
                className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ℹ {t(lang, "help")}
              </Link>
              <a
                href="mailto:samimpatan8@gmail.com?subject=Samim%20AI%20feedback"
                onClick={() => setMoreOpen(false)}
                className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                ✉ {t(lang, "feedback")}
              </a>
              <button
                type="button"
                disabled={!activeId}
                onClick={() => activeId && void doDelete(activeId)}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm text-red-600 hover:bg-slate-100 disabled:opacity-40 dark:text-red-400 dark:hover:bg-slate-800"
              >
                🗑 {t(lang, "delete")}
              </button>
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
              <p className="px-2 pb-1 pt-1 text-xs text-slate-500">🎨 {t(lang, "studios")}</p>
              {visibleStudios.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  onClick={() => setMoreOpen(false)}
                  className="block rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {s.icon} {t(lang, s.key)}
                </Link>
              ))}
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
              <p className="px-2 pb-1 pt-1 text-xs text-slate-500">{t(lang, "provider")}</p>
              <select
                value={provider}
                onChange={(e) => pickProvider(e.target.value as ProviderId)}
                className="mx-2 mb-1 w-[calc(100%-16px)] rounded-xl border border-slate-300 bg-transparent px-2 py-2 text-sm dark:border-slate-700"
                aria-label={t(lang, "provider")}
              >
                {providerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} —{" "}
                    {p.status === "ready" ? t(lang, "online") : t(lang, "providerNeedsKey")}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  setTempMode((v) => !v);
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                🔒 {t(lang, "tempChat")}
                {tempMode ? " ✓" : ""}
              </button>
              <button
                type="button"
                disabled={!activeId}
                onClick={() => {
                  void exportChatPdf();
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                📄 {t(lang, "exportPdf")}
              </button>
              <button
                type="button"
                disabled={!activeId}
                onClick={() => {
                  void exportChatDocx();
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                📝 {t(lang, "exportDocx")}
              </button>
              <button
                type="button"
                disabled={!activeId}
                onClick={() => {
                  void shareLink();
                  setMoreOpen(false);
                }}
                className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
              >
                🔗 {t(lang, "shareLink")}
              </button>
              <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
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
      {tempMode && (
        <div className="break-words bg-slate-200 px-3 py-2 text-center text-[11px] leading-relaxed text-slate-900 sm:text-xs dark:bg-slate-100 dark:text-slate-900">
          🔒 {t(lang, "tempChatNote")}
        </div>
      )}

      {/* ===== Chat area ===== */}
      <div className="chat-scroll min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-[18px] py-4">
        {messages.length === 0 ? (
          <div className="mx-auto w-full min-w-0 max-w-2xl pb-6 text-center">
            {/* Empty state keeps the video identity: centred avatar + name pill.
                The avatar is a plain <a> so the tap always works. */}
            <a
              href="/about"
              aria-label={t(lang, "about")}
              className="pointer-events-auto relative z-10 inline-block cursor-pointer rounded-full transition-transform active:scale-95"
            >
              <Image
                src="/avatar.jpg"
                alt="Samim AI"
                width={64}
                height={64}
                className="mx-auto rounded-full object-cover ring-2 ring-white/80 dark:ring-[#263550]"
              />
            </a>
            <div className="mt-3 inline-block max-w-full rounded-2xl bg-white px-3.5 py-1.5 shadow-md dark:bg-[#111B30] dark:shadow-none dark:ring-1 dark:ring-[#263550]">
              <span className="block truncate text-base text-black dark:text-[#EAF2FF]">
                {userName ?? t(lang, "appName")}
                {isAdmin && (
                  <span className="ms-1 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-black">
                    {t(lang, "admin")}
                  </span>
                )}
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
            <div className="mt-4 flex flex-wrap gap-2">
              {visibleStudios.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  {s.icon} {t(lang, s.key)}
                </Link>
              ))}
            </div>
            {!userEmail && (
              <p className="mt-4 rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {t(lang, "guestNotice")}{" "}
                <Link href="/login" className="font-bold underline">
                  {t(lang, "login")}
                </Link>
              </p>
            )}
            {tempMode && (
              <p className="mt-2 rounded-xl bg-slate-900 px-3 py-2 text-xs text-white dark:bg-slate-100 dark:text-slate-900">
                🔒 {t(lang, "tempChatNote")}
              </p>
            )}
          </div>
        ) : (
          <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5">
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
                onBranch={branchFromMessage}
                onExport={exportChat}
                actionsDisabled={streaming}
              />
            ))}
            {streaming && messages[messages.length - 1]?.content === "" && (
              <TypingDots />
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ===== Bottom input ===== */}
      <div className="min-w-0 w-full px-2.5 pb-2.5 pt-1 sm:px-3.5">
        {notice && (
          <p className="mx-auto mb-2 max-w-3xl rounded-full bg-slate-900 px-4 py-2 text-center text-xs text-white dark:bg-slate-100 dark:text-slate-900">
            {notice}
          </p>
        )}
        {(listening || recording) && (
          <p className="mx-auto mb-2 max-w-3xl text-center text-xs font-bold text-red-500">
            🎙 {recording ? t(lang, "recording") : t(lang, "listening")}
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
          className="mx-auto flex w-full min-w-0 max-w-3xl items-end gap-2 sm:gap-2.5"
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            aria-label={t(lang, "files")}
            onChange={(e) => {
              void onTextFilePicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label={t(lang, "camera")}
            onChange={(e) => {
              void onPhotoPicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label={t(lang, "photos")}
            onChange={(e) => {
              void onPhotoPicked(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="relative flex min-w-0 flex-1 items-end rounded-3xl bg-[#F0F0F0] px-2 py-1.5 sm:px-3 dark:bg-[#111B30]">
            <button
              type="button"
              onClick={() => setPlusOpen((v) => !v)}
              className="mb-1.5 shrink-0 px-1 text-2xl leading-none text-[#111111] sm:text-[26px] dark:text-[#EAF2FF]"
              aria-label="+"
            >
              ＋
            </button>
            {/* Auto-growing composer: 1 line min, 4 lines max (~120px),
              then scrolls internally. Enter sends, Shift+Enter = newline. */}
            <textarea
              ref={composerRef}
              dir="auto"
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (input.trim() || pendingImage) {
                    send(input);
                    setInput("");
                  }
                }
              }}
              placeholder={t(lang, "askPlaceholder")}
              className="bidi-plaintext max-h-[120px] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2 text-base leading-6 text-[#111111] outline-none placeholder:text-[#9A9A9A] sm:text-[17px] dark:text-[#EAF2FF]"
            />
            <button
              type="button"
              onClick={() => setLiveCallOpen(true)}
              className="mb-1.5 shrink-0 rounded-full px-1 text-xl leading-none sm:text-[22px]"
              aria-label={t(lang, "liveCall")}
            >
              🌊
            </button>
            <button
              type="button"
              onClick={startListening}
              className={`mb-1.5 shrink-0 rounded-full px-1 text-xl leading-none sm:text-[22px] ${
                listening || recording ? "mic-listening text-red-500" : ""
              }`}
              aria-label="Microphone"
            >
              🎙
            </button>
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white transition-transform active:scale-95 dark:bg-white dark:text-black"
                aria-label={t(lang, "stop")}
              >
                <span className="text-base leading-none">■</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim() && !pendingImage}
                className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#111111] text-white transition-transform disabled:bg-[#B9B9B9] active:scale-95 dark:bg-white dark:text-black dark:disabled:bg-[#334155]"
                aria-label={t(lang, "send")}
              >
                <span className="text-xl leading-none">↑</span>
              </button>
            )}
            {/* ===== + menu ===== */}
            {plusOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setPlusOpen(false)}
                  className="fixed inset-0 z-20 cursor-default"
                />
                <div className="absolute bottom-full left-2 z-30 mb-2 w-60 rounded-2xl border border-slate-200 bg-white p-2 text-start shadow-lg dark:border-[#263550] dark:bg-[#111B30]">
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      cameraInputRef.current?.click();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    📷 {t(lang, "camera")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      photoInputRef.current?.click();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    🖼 {t(lang, "photos")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    📁 {t(lang, "files")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      void openScreenShare();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    🖥 {t(lang, "screenShare")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setThinkHarder((v) => !v)}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    🧠 {t(lang, "thinkHarder")}
                    {thinkHarder ? " ✓" : ""}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      startListening();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    🎙 {t(lang, "listening")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlusOpen(false);
                      setLiveCallOpen(true);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    🌊 {t(lang, "liveCall")}
                  </button>
                </div>
              </>
            )}
          </div>
        </form>
        <p className="mt-2 text-center text-[11px] text-slate-400">
          Samim AI • {t(lang, "notMuse")}
        </p>
      </div>

      {/* ===== Screen-share preview (send one still frame to the AI) ===== */}
      {screenShareOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col rounded-2xl bg-white p-4 text-slate-900 dark:bg-[#0D1426] dark:text-[#EAF2FF]">
            <p className="text-base font-bold">{t(lang, "screenShare")}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{t(lang, "screenShareNote")}</p>
            <video
              ref={screenVideoRef}
              autoPlay
              muted
              playsInline
              className="mt-3 max-h-[55vh] w-full rounded-2xl bg-black object-contain"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={sendScreenFrame}
                className="flex-1 rounded-full bg-[#2457FF] px-4 py-2.5 text-sm font-bold text-white"
              >
                {t(lang, "screenShareSend")}
              </button>
              <button
                type="button"
                onClick={closeScreenShare}
                className="rounded-full bg-slate-200 px-4 py-2.5 text-sm dark:bg-slate-800"
              >
                {t(lang, "close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Full-screen live call ===== */}
      {liveCallOpen && (
        <LiveCall lang={lang} onClose={onLiveCallClose} onNote={showNotice} />
      )}
    </div>
  );
}
