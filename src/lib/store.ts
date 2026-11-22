/**
 * lib/store.ts — local-first storage for the Samim AI studios.
 * GUEST PRIVACY (2026-11-22): guest data is IN-MEMORY ONLY.
 * Content (chats, projects, images, workflows, runs, logs, slide
 * decks) is written to localStorage ONLY for logged-in users. Guests
 * work fully in memory: everything disappears on refresh/close.
 * Settings (language, theme, model, provider keys) are NOT chat
 * content — they always use localStorage, for guests too.
 * The mode flag defaults to memory-only (safe) and is set by
 * refreshAuthMode() once the Supabase session is known.
 * Nothing sensitive is stored here — provider keys for
 * OpenRouter/Hugging Face are the user's own keys, stored only in
 * their browser, never sent to our server.
 */
"use client";

import { supabase } from "./supabaseClient";

export type Settings = {
  lang: "en" | "ps" | "fa" | "ar";
  theme: "dark" | "light";
  model: "auto" | "fast" | "smart";
  personality: "general" | "teacher" | "coder" | "writer" | "researcher";
  systemInstructions: string;
  /** Chosen chat provider (default gemini). Other providers need the
   * user's own key below; the key is stored ONLY in this browser. */
  provider: "gemini" | "openai" | "anthropic" | "deepseek" | "grok" | "qwen" | "openrouter" | "huggingface";
  openaiKey: string;
  anthropicKey: string;
  deepseekKey: string;
  grokKey: string;
  qwenKey: string;
  openRouterKey: string;
  hfKey: string;
  features: Record<string, boolean>;
  avatarDataUrl: string;
  displayName: string;
  /** Conversation memory: facts the AI remembers about the user.
   * Only included in the system prompt when memoryEnabled is true;
   * the user can edit or clear the list any time in Settings. */
  memoryEnabled: boolean;
  memoryFacts: string[];
};

export const DEFAULT_SETTINGS: Settings = {
  lang: "ps",
  /* Default theme is LIGHT (2026-11-22): first load must match the
     reference photos (light-grey voice screen, white composer).
     Users with a stored theme keep their stored choice — only the
     default changes. Providers.tsx already defaults to "light". */
  theme: "light",
  model: "auto",
  personality: "general",
  systemInstructions: "",
  provider: "gemini",
  openaiKey: "",
  anthropicKey: "",
  deepseekKey: "",
  grokKey: "",
  qwenKey: "",
  openRouterKey: "",
  hfKey: "",
  memoryEnabled: false,
  memoryFacts: [],
  features: {
    chat: true,
    writing: true,
    coding: true,
    builder: true,
    image: true,
    slides: true,
    docs: true,
    research: true,
    workflows: true,
  },
  avatarDataUrl: "",
  displayName: "",
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  image?: string;
  file?: { filename: string; mime: string; size: number; base64: string };
  mode?: string;
  ts: number;
};

export type StudioChat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  pinned?: boolean;
};

export type ProjectFile = { path: string; content: string };
export type StudioProject = {
  id: string;
  name: string;
  kind: "code" | "app" | "doc";
  description: string;
  files: ProjectFile[];
  updatedAt: number;
};

export type StudioImage = {
  id: string;
  prompt: string;
  dataUrl: string;
  ratio: string;
  ts: number;
};

export type WorkflowStep = {
  id: string;
  kind: "input" | "ai" | "translate" | "summarise" | "write" | "image" | "document";
  label: string;
  prompt: string;
};

export type StudioWorkflow = {
  id: string;
  name: string;
  steps: WorkflowStep[];
  updatedAt: number;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  workflowName: string;
  input: string;
  output: string;
  error?: string;
  ts: number;
};

export type LogEntry = { ts: number; where: string; message: string };

const PREFIX = "samim-";

/** Guest mode: true = in-memory only, nothing touches localStorage.
 * Defaults to true (safe) until refreshAuthMode() proves a login. */
let memoryOnly = true;
/** In-memory cache used while memoryOnly is true. */
const mem: Record<string, unknown> = {};

export function isMemoryOnly(): boolean {
  return memoryOnly;
}

export function setMemoryOnly(v: boolean): void {
  memoryOnly = v;
}

/** Ask Supabase who is signed in and set the storage mode.
 * Logged-in => localStorage; guest or unconfigured => memory only. */
export async function refreshAuthMode(): Promise<void> {
  if (!supabase) {
    memoryOnly = true;
    return;
  }
  try {
    const { data } = await supabase.auth.getSession();
    memoryOnly = !data.session?.user;
  } catch {
    memoryOnly = true;
  }
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full/unavailable — the app keeps working in memory */
  }
}

/** Content read: guests read from the in-memory cache only. */
function readContent<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  if (memoryOnly) {
    const v = mem[key];
    return v === undefined ? fallback : (v as T);
  }
  return read<T>(key, fallback);
}

/** Content write: guests write to the in-memory cache only — the
 * data never reaches localStorage, so it dies with the session. */
function writeContent(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  if (memoryOnly) {
    mem[key] = value;
    return;
  }
  write(key, value);
}

export const store = {
  /** Guest-privacy mode: memory-only unless a login is proven. */
  setMemoryOnly,
  refreshAuthMode,
  isMemoryOnly,
  settings(): Settings {
    return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>("settings", {}) };
  },
  saveSettings(s: Settings): void {
    write("settings", s);
  },
  chats(): StudioChat[] {
    return readContent<StudioChat[]>("chats", []);
  },
  saveChats(c: StudioChat[]): void {
    writeContent("chats", c);
  },
  projects(): StudioProject[] {
    return readContent<StudioProject[]>("projects", []);
  },
  saveProjects(p: StudioProject[]): void {
    writeContent("projects", p);
  },
  images(): StudioImage[] {
    return readContent<StudioImage[]>("images", []);
  },
  saveImages(i: StudioImage[]): void {
    writeContent("images", i);
  },
  workflows(): StudioWorkflow[] {
    return readContent<StudioWorkflow[]>("workflows", []);
  },
  saveWorkflows(w: StudioWorkflow[]): void {
    writeContent("workflows", w);
  },
  runs(): WorkflowRun[] {
    return readContent<WorkflowRun[]>("runs", []);
  },
  saveRuns(r: WorkflowRun[]): void {
    writeContent("runs", r);
  },
  logs(): LogEntry[] {
    return readContent<LogEntry[]>("logs", []);
  },
  log(where: string, message: string): void {
    const logs = readContent<LogEntry[]>("logs", []);
    logs.unshift({ ts: Date.now(), where, message: message.slice(0, 300) });
    writeContent("logs", logs.slice(0, 100));
  },
  clearAll(): void {
    for (const k of Object.keys(mem)) delete mem[k];
    if (typeof window === "undefined") return;
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => window.localStorage.removeItem(k));
  },
};

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Language detection for TTS / prompts: ps = Pashto-only letters,
 * fa/ar = other Arabic script, en = Latin. */
export function detectLang(text: string): "ps" | "fa" | "ar" | "en" {
  const psOnly = /[څځډړږښګڼېۍﺉ]/.test(text);
  if (psOnly) return "ps";
  const arabic = /[\u0600-\u06FF]/.test(text);
  if (arabic) {
    // Dari uses ی/ک (Arabic-script Persian); Arabic uses ة/ى/إ/أ often.
    if (/[ةىإأؤ]/.test(text)) return "ar";
    return "fa";
  }
  return "en";
}
