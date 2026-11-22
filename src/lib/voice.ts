/**
 * lib/voice.ts — free browser Web Speech API (no key, no paid service).
 * Voice input: SpeechRecognition. Voice output: speechSynthesis.
 * Everything is feature-detected; callers must show an honest note
 * when the browser supports neither.
 */

import type { Lang } from "./i18n";

/** BCP-47 language tag for speech recognition, from the UI language. */
export function recognitionLang(lang: Lang): string {
  if (lang === "ps") return "ps-AF";
  if (lang === "fa") return "fa-IR";
  return "en-US";
}

/** BCP-47 language tag for speech synthesis, from the reply language. */
export function synthesisLang(lang: Lang): string {
  if (lang === "ps") return "ps-AF";
  if (lang === "fa") return "fa-IR";
  return "en-US";
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

export interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | SpeechRecognitionCtor
    | undefined;
  return Ctor ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return recognitionCtor() !== null;
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function createRecognizer(lang: Lang): SpeechRecognitionInstance | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = recognitionLang(lang);
  rec.interimResults = false;
  rec.continuous = false;
  return rec;
}

/** Strip markdown/code so the spoken text sounds natural. */
export function stripMarkdownToSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick a voice matching the language when the browser has one. */
function pickVoice(langTag: string): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const prefix = langTag.slice(0, 2).toLowerCase();
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
    voices[0] ??
    null
  );
}

/** Read text aloud. Returns false when synthesis is unavailable. */
export function speakText(
  text: string,
  lang: Lang,
  onEnd: () => void
): boolean {
  if (!isSpeechSynthesisSupported()) return false;
  const clean = stripMarkdownToSpeech(text);
  if (!clean) return false;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = synthesisLang(lang);
  const voice = pickVoice(synthesisLang(lang));
  if (voice) utter.voice = voice;
  utter.onend = onEnd;
  utter.onerror = onEnd;
  window.speechSynthesis.speak(utter);
  return true;
}

/** Stop any speech currently playing. */
export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
}

/* ================= Gemini voice fix (v3.2) =================
 * Chrome on Android has no SpeechRecognition for ps-AF and no
 * Pashto/Dari speechSynthesis voice, so the Web Speech API alone
 * fails for this user. The fixes below route through Gemini:
 *   mic  -> MediaRecorder -> POST /api/transcribe -> text in the box
 *   read -> speechSynthesis ONLY if a voice for the reply language
 *           exists, otherwise POST /api/speech -> Gemini TTS audio.
 * No new key, no paid service. */

/** Pashto-only letters (not in Dari/Persian): ځ څ ډ ړ ږ ښ ګ ڼ ې ۍ. */
const PASHTO_ONLY = /[ځڅډړږښګڼېۍ]/;

/** Detect a message's language: "ps" | "fa" | "en".
 * Arabic-script text with Pashto-only letters is Pashto; other
 * Arabic-script text is Dari; anything else is English. */
export function detectTextLang(text: string): "ps" | "fa" | "en" {
  if (PASHTO_ONLY.test(text)) return "ps";
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "fa";
  return "en";
}

/** True when the device actually has a speechSynthesis voice for
 * the language — checked against getVoices(), never assumed.
 * NOTE: getVoices() can be empty until voiceschanged fires; callers
 * should re-check after that event when it returns false. */
export function hasSpeechVoice(lang: "ps" | "fa" | "en"): boolean {
  if (!isSpeechSynthesisSupported()) return false;
  const prefix = lang === "ps" ? "ps" : lang === "fa" ? "fa" : "en";
  return window.speechSynthesis
    .getVoices()
    .some((v) => v.lang.toLowerCase().startsWith(prefix));
}

export function isMediaRecorderSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "MediaRecorder" in window &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result ?? "");
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

/** Send a recorded audio blob to Gemini transcription.
 * Returns the transcript, or null when it failed.
 * Throws an Error with code "no-key" when the server has no key
 * (offline) so the caller can say so honestly. */
export async function transcribeRecording(blob: Blob): Promise<string | null> {
  const base64 = await blobToBase64(blob);
  const res = await fetch("/api/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: base64, mimeType: blob.type || "audio/webm" }),
  });
  if (res.status === 503) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    const err = new Error(data.error === "no-key" ? "no-key" : "transcribe-failed");
    (err as Error & { code?: string }).code = data.error === "no-key" ? "no-key" : "failed";
    throw err;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { text?: string | null };
  return data.text?.trim() ? data.text.trim() : null;
}

export type GeminiAudio = {
  audio: HTMLAudioElement;
  stop: () => void;
};

/** Play Gemini TTS audio for text in `lang`.
 * Returns null when the TTS model is unavailable for this key —
 * the caller must then fall back honestly, never fake the voice. */
export async function playGeminiSpeech(
  text: string,
  lang: "ps" | "fa" | "en",
  onEnd: () => void
): Promise<GeminiAudio | null> {
  const res = await fetch("/api/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { audio?: string | null };
  if (!data.audio) return null;
  const audio = new Audio(data.audio);
  audio.onended = onEnd;
  audio.onerror = onEnd;
  await audio.play();
  return {
    audio,
    stop: () => {
      audio.pause();
      onEnd();
    },
  };
}
