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
