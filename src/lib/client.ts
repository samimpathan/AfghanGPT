/**
 * lib/client.ts — shared browser helpers for every studio.
 * All AI calls go through our own /api/* routes; no key ever
 * leaves the server, and no key is ever in this file.
 */
"use client";

import type { FileSpec } from "@/lib/filegen";
import { detectLang } from "@/lib/store";
import { supabase } from "@/lib/supabaseClient";

/** Current session access token, for server-side founder checks
 * (image generation is founder-only — see lib/founderAuth.ts).
 * Null for guests and when Supabase is not configured. Never throws. */
export async function getAccessToken(): Promise<string | null> {
  try {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Authorization header for /api/* calls that need the founder
 * check. Guests send no header and are refused server-side. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type ApiChatMsg = {
  role: "user" | "assistant";
  content: string;
  image?: string;
};

export type ChatMeta = {
  mode?: string;
  file?: { filename: string; mime: string; size: number; base64: string };
  image?: string;
};

export const PERSONALITY_PROMPTS: Record<string, string> = {
  general: "",
  teacher:
    "Act as a patient teacher. Explain step by step, with simple examples, and check understanding at the end.",
  coder:
    "Act as a senior software engineer. Give correct, runnable code with brief explanations, and point out bugs and edge cases.",
  writer:
    "Act as a professional editor and writer. Write clearly, with good structure, correct grammar, and an engaging tone.",
  researcher:
    "Act as a careful researcher. Distinguish verified facts from uncertain claims, say when something is not verified, and never invent sources or citations.",
};

export function personalitySystem(personality: string, custom: string): string {
  const parts: string[] = [];
  if (PERSONALITY_PROMPTS[personality]) parts.push(PERSONALITY_PROMPTS[personality]);
  if (custom.trim()) parts.push(`User's own instructions: ${custom.trim()}`);
  return parts.join("\n");
}

/** Stream a chat reply. Yields text chunks. For file/image replies
 * the server answers JSON instead — onMeta is called and nothing
 * is yielded. Throws on network/HTTP errors. */
export async function* streamChat(
  messages: ApiChatMsg[],
  opts: { mode?: "auto" | "fast" | "smart"; system?: string; onMeta?: (m: ChatMeta) => void }
): AsyncGenerator<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ messages, mode: opts.mode ?? "auto", system: opts.system ?? "" }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}`);
  const mode = res.headers.get("X-SamimAI-Mode") ?? "";
  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as { text?: string; file?: ChatMeta["file"]; image?: string };
    opts.onMeta?.({ mode, file: json.file, image: json.image });
    if (json.text) yield json.text;
    return;
  }
  if (!res.body) {
    opts.onMeta?.({ mode });
    return;
  }
  opts.onMeta?.({ mode });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) yield text;
    }
  } finally {
    reader.releaseLock();
  }
}

/** Full non-streaming text reply (for JSON specs, summaries, etc.). */
export async function chatText(
  messages: ApiChatMsg[],
  system = "",
  mode: "auto" | "fast" | "smart" = "smart"
): Promise<{ text: string; mode: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ messages, mode, system, format: "json" }),
  });
  if (!res.ok) throw new Error(`chat ${res.status}`);
  const modeOut = res.headers.get("X-SamimAI-Mode") ?? "";
  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? "", mode: modeOut };
  }
  return { text: await res.text(), mode: modeOut };
}

/** Ask the AI for a strict JSON object; strips fences and extracts {...}. */
export async function chatJson<T>(
  messages: ApiChatMsg[],
  system = "",
  mode: "auto" | "fast" | "smart" = "smart"
): Promise<T> {
  const { text } = await chatText(messages, system, mode);
  let jsonText = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = jsonText.indexOf("{");
  const last = jsonText.lastIndexOf("}");
  if (first >= 0 && last > first) jsonText = jsonText.slice(first, last + 1);
  return JSON.parse(jsonText) as T;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

/** Generate a real file server-side and download it. */
export async function downloadFileSpec(spec: FileSpec): Promise<void> {
  const res = await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `files ${res.status}`);
  }
  const blob = await res.blob();
  const disp = res.headers.get("Content-Disposition") ?? "";
  const m = /filename="([^"]+)"/.exec(disp);
  downloadBlob(blob, m?.[1] ?? spec.filename);
}

export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read-failed"));
    r.readAsDataURL(file);
  });
}

export async function readFileText(file: File): Promise<string> {
  return file.text();
}

/** Recorded audio → transcript via Gemini (server). Returns null on failure. */
export async function transcribeBlob(blob: Blob): Promise<string | null> {
  const base64 = await fileToDataUrl(blob);
  const match = /^data:([^;]+);base64,(.+)$/.exec(base64);
  if (!match) return null;
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: match[2], mimeType: match[1] }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { text?: string | null };
  return json.text ?? null;
}

let currentAudio: HTMLAudioElement | null = null;

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* no speech synthesis */
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/** Read text aloud in its own language. Tries Gemini TTS first when
 * the device has no voice for that language; falls back to the
 * device voice; returns false when nothing could speak it. */
export async function speak(text: string): Promise<boolean> {
  stopSpeaking();
  const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/[#*`>|]/g, " ").slice(0, 4000);
  if (!clean.trim()) return false;
  const lang = detectLang(clean);
  const hasVoice =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    window.speechSynthesis.getVoices().some((v) => v.lang.toLowerCase().startsWith(lang));
  if (!hasVoice) {
    try {
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, lang }),
      });
      if (res.ok) {
        const json = (await res.json()) as { audio?: string | null };
        if (json.audio) {
          currentAudio = new Audio(json.audio);
          await currentAudio.play();
          return true;
        }
      }
    } catch {
      /* fall through to device voice */
    }
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = lang === "ps" ? "fa-IR" : lang === "fa" ? "fa-IR" : lang === "ar" ? "ar-SA" : "en-US";
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      window.speechSynthesis.speak(u);
    });
  }
  return false;
}
