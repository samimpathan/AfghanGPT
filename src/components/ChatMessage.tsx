"use client";

import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";
import { Icon } from "@/components/icons";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t, type Lang } from "@/lib/i18n";
import { stripMathDelimiters } from "@/lib/mathText";
import { PromptCard, plainTextOf } from "@/components/Markdown";
import UserAvatar, { gradientById } from "@/components/UserAvatar";
import {
  isSpeechSynthesisSupported,
  speakText,
  stopSpeaking,
  detectTextLang,
  hasSpeechVoice,
  playGeminiSpeech,
  type GeminiAudio,
} from "@/lib/voice";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "gemini" | "offline" | "refused" | "busy" | "image" | "file" | "provider" | "web";
  /** Which provider answered (when mode is "provider"). */
  provider?: string;
  /** Attached photo / generated image as a data URL. */
  image?: string;
  /** A real generated file (v3.2): downloaded from a data URL. */
  file?: { filename: string; mime: string; size: number; base64: string };
};

const REACTIONS_KEY = "samim-ai-reactions";
const REPORTS_KEY = "samim-ai-reports";

function loadReactions(): Record<string, "like" | "dislike"> {
  try {
    const raw = localStorage.getItem(REACTIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, "like" | "dislike">) : {};
  } catch {
    return {};
  }
}

const actionBtn =
  "rounded-full px-2 py-1 text-xs text-[var(--muted)] transition duration-150 hover:bg-[var(--surface-hover)] focus-visible:outline-2 focus-visible:outline-[#2457FF] disabled:opacity-40";
/** Icon-only assistant action buttons (Round 3 item K, ChatGPT-style):
 * fixed 32px square so the six icons line up in both themes and at
 * phone width; the active variant marks a saved reaction / speaking. */
const actionIconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--muted)] transition duration-150 hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[#2457FF] disabled:opacity-40";
const actionIconBtnActive =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-hover)] text-[var(--foreground)] transition duration-150";
/** Liked/disliked state: the chosen button turns solid black (solid
 * white in dark mode) and the other one disappears — the owner's
 * rule (2026-11-25). Tapping the black button again clears it and
 * the other button comes back. */
const actionIconBtnLiked =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white transition duration-150 dark:bg-white dark:text-black";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function CopyButton({ text, lang, iconOnly }: { text: string; lang: Lang; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            // clipboard unavailable
          }
        }}
        className={actionIconBtn}
        aria-label={done ? t(lang, "copied") : t(lang, "copy")}
        title={done ? t(lang, "copied") : t(lang, "copy")}
      >
        {done ? (<Icon name="check" size={16} />) : (<Icon name="copy" size={16} />)}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard unavailable
        }
      }}
      className={actionBtn}
      aria-label={t(lang, "copy")}
    >
      {done ? (<><Icon name="check" size={13} className="me-1 inline-block align-middle" />{t(lang, "copied")}</>) : (<><Icon name="copy" size={13} className="me-1 inline-block align-middle" />{t(lang, "copy")}</>)}
    </button>
  );
}

/** Save a generated image into the browser (persisted list, max 10). */
function SaveImageButton({ image, lang }: { image: string; lang: Lang }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          const raw = localStorage.getItem("samim-ai-saved-images");
          const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
          list.unshift(image);
          localStorage.setItem(
            "samim-ai-saved-images",
            JSON.stringify(list.slice(0, 10))
          );
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        } catch {
          // storage unavailable
        }
      }}
      className={actionBtn}
    >
      {saved ? (<><Icon name="check" size={13} className="me-1 inline-block align-middle" />{t(lang, "saved")}</>) : (<><Icon name="bookmark" size={13} className="me-1 inline-block align-middle" />{t(lang, "save")}</>)}
    </button>
  );
}

/** Read an assistant reply aloud — in the REPLY's language.
 * v3.2 voice fix: speechSynthesis is used ONLY when the device
 * actually has a voice for that language (checked with getVoices).
 * Otherwise Gemini TTS (/api/speech) speaks it. If neither works,
 * say honestly that this language's voice is not available yet —
 * never claim it spoke the language when it did not. */
function SpeakButton({
  text,
  lang,
  onNote,
}: {
  text: string;
  lang: Lang;
  onNote?: (text: string) => void;
}) {
  const [speaking, setSpeaking] = useState(false);
  const geminiAudioRef = useRef<GeminiAudio | null>(null);
  useEffect(
    () => () => {
      stopSpeaking();
      geminiAudioRef.current?.stop();
    },
    []
  );
  const toggle = async () => {
    if (speaking) {
      stopSpeaking();
      geminiAudioRef.current?.stop();
      geminiAudioRef.current = null;
      setSpeaking(false);
      return;
    }
    const replyLang = detectTextLang(text);
    // Fast path: the device really has a voice for this language.
    if (hasSpeechVoice(replyLang)) {
      const ok = speakText(text, replyLang, () => setSpeaking(false));
      if (ok) {
        setSpeaking(true);
        return;
      }
    }
    // Gemini TTS for Pashto/Dari (and any language without a voice).
    setSpeaking(true);
    const played = await playGeminiSpeech(text, replyLang, () => setSpeaking(false));
    if (played) {
      geminiAudioRef.current = played;
      return;
    }
    // TTS model unavailable for this key — honest fallback: try the
    // device voice anyway (it may speak, in the wrong accent), and
    // if there is none at all, say so.
    geminiAudioRef.current = null;
    setSpeaking(false);
    if (isSpeechSynthesisSupported()) {
      const ok = speakText(text, replyLang, () => setSpeaking(false));
      if (ok) {
        setSpeaking(true);
        onNote?.(t(lang, "voiceTtsUnavailable"));
        return;
      }
    }
    onNote?.(t(lang, "voiceTtsUnavailable"));
  };
  return (
    <button
      type="button"
      onClick={toggle}
      className={speaking ? actionIconBtnActive : actionIconBtn}
      aria-label={t(lang, speaking ? "stop" : "speak")}
      title={t(lang, speaking ? "stop" : "speak")}
    >
      {speaking ? (<Icon name="stop" size={16} />) : (<Icon name="speaker" size={16} />)}
    </button>
  );
}

/** Build a standalone HTML document for a code preview. */
function buildPreviewDoc(codeLang: string, code: string): string {
  if (codeLang === "html") {
    return code.includes("<html")
      ? code
      : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${code}</body></html>`;
  }
  if (codeLang === "css") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${code}</style></head><body><h1>Preview</h1><p>This text shows your styles.</p><button>Button</button></body></html>`;
  }
  // JavaScript: capture console output so the user can see results.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><pre id="log" style="font-family:monospace;white-space:pre-wrap"></pre><script>var _log=document.getElementById('log');['log','error','warn'].forEach(function(k){var o=console[k];console[k]=function(){o.apply(console,arguments);_log.textContent+=Array.from(arguments).map(String).join(' ')+'\n';};});window.onerror=function(m){_log.textContent+='Error: '+m+'\n';};</script><script>${code}</script></body></html>`;
}

const WEB_LANGS = new Set(["html", "css", "js", "javascript"]);
const NOTE_LANGS = new Set(["python", "cpp", "c++", "c", "java"]);

function CodeBlock({
  codeLang,
  code,
  uiLang,
}: {
  codeLang: string;
  code: string;
  uiLang: Lang;
}) {
  const [done, setDone] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const lower = codeLang.toLowerCase();
  const isWeb = WEB_LANGS.has(lower);
  const isNoteLang = NOTE_LANGS.has(lower);
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[#263550] bg-[#0d1426] text-slate-100 shadow-sm" dir="ltr">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white/[0.04] px-3 py-1.5 text-xs">
        <span className="font-semibold text-cyan-300">{codeLang || "code"}</span>
        <span className="flex gap-2">
          {(isWeb || isNoteLang) && (
            <button
              type="button"
              onClick={() => {
                if (isWeb) setShowPreview((v) => !v);
                else setShowNote((v) => !v);
              }}
              className="rounded-lg bg-emerald-600 px-2.5 py-1 font-semibold text-white transition duration-150 hover:bg-emerald-500 focus-visible:outline-2 focus-visible:outline-emerald-300 active:scale-95"
            >
              <Icon name="play" size={13} className="me-1 inline-block align-middle" /> {t(uiLang, "run")}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setDone(true);
                setTimeout(() => setDone(false), 1500);
              } catch {
                // ignore
              }
            }}
            className="rounded-lg bg-slate-700 px-2.5 py-1 font-semibold transition duration-150 hover:bg-slate-600 focus-visible:outline-2 focus-visible:outline-slate-300 active:scale-95"
          >
            {done ? (<><Icon name="check" size={13} className="me-1 inline-block align-middle" />{t(uiLang, "copied")}</>) : (<><Icon name="copy" size={13} className="me-1 inline-block align-middle" />{t(uiLang, "copyCode")}</>)}
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-relaxed">
        <code>{code}</code>
      </pre>
      {showNote && (
        <p className="border-t border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-300">
          {t(uiLang, "runNote")}
        </p>
      )}
      {showPreview && (
        <div className="border-t border-slate-700">
          <div className="flex items-center justify-between bg-slate-800 px-3 py-1.5 text-xs">
            <span>{t(uiLang, "preview")}</span>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600"
            >
              <Icon name="x" size={13} className="me-1 inline-block align-middle" /> {t(uiLang, "close")}
            </button>
          </div>
          <iframe
            title="Code preview"
            sandbox="allow-scripts"
            srcDoc={buildPreviewDoc(lower, code)}
            className="h-80 w-full bg-white"
          />
        </div>
      )}
    </div>
  );
}

/** File card (v3.2): a REAL generated file with a Download button. */
function FileCard({ file, lang }: { file: NonNullable<UiMessage["file"]>; lang: Lang }) {
  const href = `data:${file.mime};base64,${file.base64}`;
  const isZip = file.filename.toLowerCase().endsWith(".zip");
  return (
    <div className="my-2 flex items-center gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 shadow-sm">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2457FF] text-xl text-white">
        {isZip ? <Icon name="archive" size={22} /> : <Icon name="fileText" size={22} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{file.filename}</p>
        <p className="text-xs text-slate-500">
          {t(lang, "fileReady")} • {formatSize(file.size)}
          {isZip ? " • ZIP" : ""}
        </p>
      </div>
      <a
        href={href}
        download={file.filename}
        className="shrink-0 rounded-full bg-[#2457FF] px-4 py-2 text-xs font-bold text-white hover:bg-blue-700"
      >
        <Icon name="download" size={13} className="me-1 inline-block align-middle" /> {t(lang, "downloadFile")}
      </a>
    </div>
  );
}

/** Visible space above/below a button inside the chat scroll area.
 * The old code measured to the viewport bottom — but the menu lives
 * inside the .chat-scroll container, whose bottom edge sits above
 * the composer bar. Measuring to the viewport counted the composer's
 * ~100px as free space, so on the bottom-most message the menu
 * opened downward and its last items were cut off behind the
 * composer. Measure to the scroll container's edge instead
 * (viewport bottom only when no scroll ancestor exists). */
function visibleMenuSpace(btn: HTMLElement): { below: number; above: number } {
  const rect = btn.getBoundingClientRect();
  const scrollEl = btn.closest(".chat-scroll");
  if (scrollEl) {
    const r = scrollEl.getBoundingClientRect();
    return { below: r.bottom - rect.bottom, above: rect.top - r.top };
  }
  return { below: window.innerHeight - rect.bottom, above: rect.top };
}

export default function ChatMessage({
  msg,
  lang,
  userAvatar,
  onRegenerate,
  isLastAssistant,
  /** True while this (last) assistant message is still streaming —
   * its avatar shows the answering video instead of the photo. */
  isStreaming,
  /** ChatGPT-style edit: tapping Edit puts this message's text back
   * into the composer (page.tsx) for editing + re-sending — there
   * is no inline editor anymore (owner, 2026-11-25). */
  onEditToComposer,
  onDeleteMessage,
  onNote,
  onBranch,
  onExport,
  actionsDisabled,
  /** The real model/mode string used for this chat, e.g.
   * "AfghanGPT Auto" — shown at the foot of the
   * message ••• menu ("Used …" line). */
  modelUsed,
}: {
  msg: UiMessage;
  lang: Lang;
  /** The sender's avatar (photo or generated initials) — shown next
   * to the user's own messages, like Muse shows it. `fallbackPhoto`
   * is the default photo for a LOGGED-IN user with no uploaded photo
   * ("/avatar.jpg"); never pass it for guests. */
  userAvatar?: { name?: string | null; email?: string | null; photoUrl?: string | null; fallbackPhoto?: string | null; gradientId?: string | null };
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
  isStreaming?: boolean;
  onEditToComposer?: () => void;
  onDeleteMessage?: (id: string) => void;
  onNote?: (text: string) => void;
  onBranch?: (msgId: string) => void;
  onExport?: () => void;
  actionsDisabled?: boolean;
  modelUsed?: string;
}) {
  const isUser = msg.role === "user";
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  /** The answering video failed to load — fall back to the photo
   * for this message instead of showing an empty circle. */
  const [avatarVideoFailed, setAvatarVideoFailed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  /** ChatGPT-style "Share feedback" bottom sheet (owner, 2026-11-25):
   * an Issue category + optional details, opened from the ••• menu.
   * Reports stay local-only (REPORTS_KEY, max 50) — no backend. */
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("wrong");
  const [reportText, setReportText] = useState("");
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  /** px the ••• menu is shifted right so it never leaves the viewport
   * (see the clamp effect below). 0 wherever it already fits. */
  const [moreMenuShift, setMoreMenuShift] = useState(0);
  /** The ••• menu opens UPWARD when the button sits near the bottom
   * of the viewport (e.g. the last message, just above the composer
   * on a phone) — opening downward there hides the menu below the
   * fold. Same for the Share menu (shareMenuFlipUp). */
  const [moreMenuFlipUp, setMoreMenuFlipUp] = useState(false);
  const [shareMenuFlipUp, setShareMenuFlipUp] = useState(false);
  /** px cap on a menu's height when it fits neither below nor above
   * the button: the menu scrolls internally instead of being cut
   * off. null = natural height. */
  const [moreMenuMaxHeight, setMoreMenuMaxHeight] = useState<number | null>(null);
  const [shareMenuMaxHeight, setShareMenuMaxHeight] = useState<number | null>(null);
  const shareBtnRef = useRef<HTMLButtonElement | null>(null);
  const shareMenuRef = useRef<HTMLDivElement | null>(null);
  /** ChatGPT-style long-press menu (owner, 2026-11-25): touch-hold
   * (~500ms, no movement) or right-click opens a popup at the press
   * point — Copy / Select text / Edit message / Share prompt for
   * user messages, Copy / Select text / Share for AI replies. */
  const [lpMenu, setLpMenu] = useState<{ x: number; y: number } | null>(null);
  const [lpPos, setLpPos] = useState<{ left: number; top: number } | null>(null);
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lpStartRef = useRef<{ x: number; y: number } | null>(null);
  const lpMenuRef = useRef<HTMLDivElement | null>(null);
  /** The selectable text of this message (user bubble / AI markdown)
   * — "Select text" selects its whole contents natively. */
  const contentRef = useRef<HTMLDivElement | null>(null);
  /** R3-B: the gradient the user picked in Settings (Avatar colour),
   * threaded in via userAvatar.gradientId (page.tsx syncs
   * settings.avatarGradient into userGradient). Null = Auto/empty:
   * keep the default bubble exactly as-is. When set, the sent
   * bubble (main row + edit row) uses this gradient with WHITE
   * text — the same treatment as the avatar initials. */
  const userBubbleGradient = gradientById(userAvatar?.gradientId);

  useEffect(() => {
    setReaction(loadReactions()[msg.id] ?? null);
  }, [msg.id]);

  // ••• menu viewport clamp (audit §9 P0 item 6): the menu is
  // right-anchored to its button (physical right-0 — the row is
  // dir="ltr", so it cannot flip by language) and opens downward.
  // On a phone the action row wraps, so the ••• button can sit near
  // the left edge (right edge ≈165px at 390px) where a 224px
  // right-anchored menu would stick out left by ~60px. Shift it right
  // just enough to keep its left edge ≥8px inside the viewport;
  // everywhere it already fits the shift is 0 and the menu stays
  // exactly right-aligned with the button.
  useEffect(() => {
    if (!moreOpen) {
      setMoreMenuShift(0);
      setMoreMenuFlipUp(false);
      setMoreMenuMaxHeight(null);
      return;
    }
    const clamp = () => {
      const btn = moreBtnRef.current;
      const menu = moreMenuRef.current;
      if (!btn || !menu) return;
      // Right-anchored: the menu's right edge sits on the button's
      // right edge, so its left edge would be right - width.
      const left = btn.getBoundingClientRect().right - menu.offsetWidth;
      setMoreMenuShift(Math.max(0, 8 - left));
      // Vertical flip: opening downward needs the menu's height
      // below the button; near the bottom (last message above the
      // composer on a phone) that space does not exist, so the menu
      // opens upward instead of hiding below the fold.
      const { below, above } = visibleMenuSpace(btn);
      const h = menu.offsetHeight;
      const flip = below < h + 8;
      setMoreMenuFlipUp(flip);
      // If the menu fits neither below nor above, clamp it to the
      // larger side with internal scrolling so every item stays
      // reachable instead of cut off behind the composer.
      const room = flip ? above : below;
      setMoreMenuMaxHeight(room < h + 8 ? Math.max(120, room - 8) : null);
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [moreOpen, isLastAssistant]);

  // Share menu viewport flip — same rule as the ••• menu above:
  // open upward when there is no room below the button.
  useEffect(() => {
    if (!shareMenuOpen) {
      setShareMenuFlipUp(false);
      setShareMenuMaxHeight(null);
      return;
    }
    const clamp = () => {
      const btn = shareBtnRef.current;
      const menu = shareMenuRef.current;
      if (!btn || !menu) return;
      const { below, above } = visibleMenuSpace(btn);
      const h = menu.offsetHeight;
      const flip = below < h + 8;
      setShareMenuFlipUp(flip);
      const room = flip ? above : below;
      setShareMenuMaxHeight(room < h + 8 ? Math.max(120, room - 8) : null);
    };
    clamp();
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [shareMenuOpen]);

  // Long-press menu clamp: keep the popup inside the viewport —
  // open upward when there is no room below the press point, and
  // never past the right edge.
  useEffect(() => {
    if (!lpMenu) {
      setLpPos(null);
      return;
    }
    const el = lpMenuRef.current;
    if (!el) {
      setLpPos({ left: lpMenu.x, top: lpMenu.y });
      return;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(lpMenu.x, window.innerWidth - w - 8));
    let top = lpMenu.y;
    if (top + h > window.innerHeight - 8) top = Math.max(8, lpMenu.y - h - 8);
    setLpPos({ left, top });
  }, [lpMenu]);

  // Escape closes the open menus (••• / Share / long-press) and the
  // feedback sheet — the sheet also has a close button and a
  // backdrop, but Escape is the standard way out of a menu.
  useEffect(() => {
    if (!moreOpen && !shareMenuOpen && !feedbackOpen && !lpMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setShareMenuOpen(false);
        setFeedbackOpen(false);
        setLpMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, shareMenuOpen, feedbackOpen, lpMenu]);

  const setReactionStored = (value: "like" | "dislike") => {
    const next = value === reaction ? null : value;
    setReaction(next);
    try {
      const all = loadReactions();
      if (next) all[msg.id] = next;
      else delete all[msg.id];
      localStorage.setItem(REACTIONS_KEY, JSON.stringify(all));
    } catch {
      // ignore
    }
  };

  // Share: the native OS share sheet where it exists (real phones);
  // where it does not (desktop/headless browsers) a real options
  // menu instead of silently copying — the old fallback copied the
  // text with no options, which the owner rejected. A cancelled
  // native sheet (AbortError) does nothing — no menu, no copy.
  const shareMessage = async () => {
    const text = msg.content;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    setMoreOpen(false);
    setShareMenuOpen((v) => !v);
  };

  const copyShareText = async () => {
    setShareMenuOpen(false);
    try {
      await navigator.clipboard.writeText(msg.content);
      onNote?.(t(lang, "copied"));
    } catch {
      // ignore
    }
  };

  const openShareApp = (base: string) => {
    setShareMenuOpen(false);
    window.open(`${base}${encodeURIComponent(msg.content)}`, "_blank", "noopener,noreferrer");
  };

  // ---- Long-press menu (ChatGPT-style) ----
  const cancelLpTimer = () => {
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current);
      lpTimerRef.current = null;
    }
    lpStartRef.current = null;
  };
  /** Touch-hold only (mouse uses right-click, below): a press that
   * stays put for ~500ms opens the menu at the press point. Any
   * movement cancels it, so scrolling never opens the menu; a press
   * starting on a link or button is left alone entirely, so taps
   * and link holds keep their native behaviour. */
  const onLpPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch") return;
    if ((e.target as HTMLElement).closest("a,button")) return;
    lpStartRef.current = { x: e.clientX, y: e.clientY };
    lpTimerRef.current = setTimeout(() => {
      setLpMenu({ x: e.clientX, y: e.clientY });
      lpTimerRef.current = null;
    }, 500);
  };
  const onLpPointerMove = (e: ReactPointerEvent) => {
    const start = lpStartRef.current;
    if (!start) return;
    if (Math.abs(e.clientX - start.x) > 10 || Math.abs(e.clientY - start.y) > 10) cancelLpTimer();
  };
  /** Right-click on desktop (and long-press where the browser fires
   * a context menu): same popup at the cursor. Links/buttons keep
   * their native menu. */
  const onLpContextMenu = (e: ReactMouseEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    e.preventDefault();
    cancelLpTimer();
    setLpMenu({ x: e.clientX, y: e.clientY });
  };
  const lpCopy = async () => {
    setLpMenu(null);
    try {
      await navigator.clipboard.writeText(msg.content);
      onNote?.(t(lang, "copied"));
    } catch {
      // ignore
    }
  };
  /** Enable native text selection on this message: select its whole
   * contents, so the user gets the system selection handles and can
   * narrow the selection to any part of it. */
  const lpSelectText = () => {
    setLpMenu(null);
    const el = contentRef.current;
    if (!el) return;
    try {
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.addRange(range);
    } catch {
      // ignore
    }
  };
  const lpEdit = () => {
    setLpMenu(null);
    onEditToComposer?.();
  };
  const lpShare = () => {
    setLpMenu(null);
    void shareMessage();
  };

  /** The Share options menu (native sheet where it exists, else
   * Copy text / WhatsApp / Telegram) — shared by the assistant
   * action row and the user action row: one copy, used in both
   * branches below. */
  const shareMenuJsx = shareMenuOpen ? (
    <>
      <button
        type="button"
        aria-label={t(lang, "closeMenu")}
        onClick={() => setShareMenuOpen(false)}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        ref={shareMenuRef}
        style={shareMenuMaxHeight ? { maxHeight: shareMenuMaxHeight } : undefined}
        className={
          shareMenuFlipUp
            ? `absolute bottom-full right-0 z-30 mb-1 w-56 max-w-[90vw] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-md${shareMenuMaxHeight ? " overflow-y-auto" : ""}`
            : `absolute right-0 top-full z-30 mt-1 w-56 max-w-[90vw] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-md${shareMenuMaxHeight ? " overflow-y-auto" : ""}`
        }
      >
        <button
          type="button"
          onClick={copyShareText}
          className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
        >
          <Icon name="copy" size={14} className="me-2 inline-block align-middle" /> {t(lang, "copyText")}
        </button>
        <button
          type="button"
          onClick={() => openShareApp("https://wa.me/?text=")}
          className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
        >
          <Icon name="external" size={14} className="me-2 inline-block align-middle" /> {t(lang, "shareViaWhatsApp")}
        </button>
        <button
          type="button"
          onClick={() => openShareApp("https://t.me/share/url?url=&text=")}
          className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
        >
          <Icon name="external" size={14} className="me-2 inline-block align-middle" /> {t(lang, "shareViaTelegram")}
        </button>
      </div>
    </>
  ) : null;

  /** The long-press popup — same shell for both roles; the items
   * differ (user messages can be edited, AI replies cannot). */
  const lpMenuJsx = lpMenu ? (
    <>
      <button
        type="button"
        aria-label={t(lang, "closeMenu")}
        onClick={() => setLpMenu(null)}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        ref={lpMenuRef}
        role="menu"
        style={lpPos ? { left: lpPos.left, top: lpPos.top } : { left: lpMenu.x, top: lpMenu.y }}
        className="fixed z-50 w-56 max-w-[90vw] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-md"
      >
        <button
          type="button"
          onClick={() => void lpCopy()}
          className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
        >
          <Icon name="copy" size={14} className="me-2 inline-block align-middle" /> {t(lang, "copy")}
        </button>
        <button
          type="button"
          onClick={lpSelectText}
          className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
        >
          <Icon name="select" size={14} className="me-2 inline-block align-middle" /> {t(lang, "selectText")}
        </button>
        {isUser && (
          <button
            type="button"
            onClick={lpEdit}
            className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
          >
            <Icon name="pencil" size={14} className="me-2 inline-block align-middle" /> {t(lang, "editMessage")}
          </button>
        )}
        <button
          type="button"
          onClick={lpShare}
          className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
        >
          <Icon name="share" size={14} className="me-2 inline-block align-middle" /> {isUser ? t(lang, "sharePrompt") : t(lang, "shareMessage")}
        </button>
      </div>
    </>
  ) : null;

  const submitReport = () => {
    try {
      const raw = localStorage.getItem(REPORTS_KEY);
      const list = raw ? (JSON.parse(raw) as { msgId: string; category?: string; note: string; at: string }[]) : [];
      list.push({ msgId: msg.id, category: feedbackCategory, note: reportText.trim(), at: new Date().toISOString() });
      localStorage.setItem(REPORTS_KEY, JSON.stringify(list.slice(-50)));
    } catch {
      // ignore
    }
    setReportText("");
    setFeedbackOpen(false);
    setMoreOpen(false);
    onNote?.(t(lang, "reportSent"));
  };

  if (isUser) {
    // Message sides are PHYSICAL, not logical: the user's bubble is
    // ALWAYS on the RIGHT and the AI answer ALWAYS on the LEFT, in
    // both RTL (Pashto/Dari) and LTR (English) — like the video and
    // like ChatGPT. justify-end flips in RTL (main axis runs
    // right-to-left, so "end" is the left side), which is exactly
    // how the sides got reversed in Pashto. Forcing dir="ltr" on the
    // row keeps justify-end physical RIGHT; the text inside still
    // picks its own direction per line via dir="auto" + plaintext
    // bidi. The user's own avatar sits at the right end, like Muse
    // shows it.
    return (
      <div
        dir="ltr"
        className="msg-in flex min-w-0 items-start justify-end gap-2"
        onPointerDown={onLpPointerDown}
        onPointerMove={onLpPointerMove}
        onPointerUp={cancelLpTimer}
        onPointerCancel={cancelLpTimer}
        onPointerLeave={cancelLpTimer}
        onContextMenu={onLpContextMenu}
      >
        <div className="min-w-0 max-w-[78%]">
          {msg.image && (
            <img
              src={msg.image}
              alt=""
              className="mb-2 ml-auto block max-h-56 w-auto max-w-full rounded-2xl object-cover shadow-sm"
            />
          )}
          <div
            ref={contentRef}
            className={`break-words rounded-[28px] px-[18px] py-3 text-[17px] leading-6 shadow-sm ${
              userBubbleGradient
                ? "text-white"
                : "bg-[var(--bubble-user)] text-[var(--foreground)]"
            }`}
            style={
              userBubbleGradient
                ? {
                    background: userBubbleGradient.background,
                    textShadow: "0 1px 2px rgba(0, 0, 0, 0.30)",
                  }
                : undefined
            }
            dir="auto"
          >
            <p className="bidi-plaintext whitespace-pre-wrap">{msg.content}</p>
          </div>
          {/* Your own message's action row (ChatGPT-style, owner
              2026-11-25): Copy, Edit (back into the composer),
              Share (native sheet or Copy/WhatsApp/Telegram), Delete.
              No Like/Dislike — those are feedback on AI replies. */}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5 px-1">
            <CopyButton text={msg.content} lang={lang} />
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => onEditToComposer?.()}
              className={actionBtn}
            >
              <Icon name="pencil" size={13} className="me-1 inline-block align-middle" /> {t(lang, "edit")}
            </button>
            <div className="relative">
              <button
                type="button"
                ref={shareBtnRef}
                disabled={actionsDisabled}
                onClick={shareMessage}
                className={actionBtn}
                aria-label={t(lang, "shareMessage")}
              >
                <Icon name="share" size={13} className="me-1 inline-block align-middle" /> {t(lang, "shareMessage")}
              </button>
              {shareMenuJsx}
            </div>
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => onDeleteMessage?.(msg.id)}
              className={`${actionBtn} text-red-600 dark:text-red-400`}
            >
              <Icon name="trash" size={13} className="me-1 inline-block align-middle" /> {t(lang, "delete")}
            </button>
          </div>
        </div>
        <UserAvatar
          name={userAvatar?.name}
          email={userAvatar?.email}
          photoUrl={userAvatar?.photoUrl}
          fallbackPhoto={userAvatar?.fallbackPhoto}
          gradientId={userAvatar?.gradientId}
          size={32}
          className="mt-1"
        />
        {lpMenuJsx}
      </div>
    );
  }

  // Assistant: PLAIN TEXT (no bubble, Gemini/ChatGPT style) with a
  // small circular avatar at the start (ChatGPT-style) and the
  // action row underneath: like/dislike, regenerate, share, copy,
  // ••• (Branch / Export / Report), speaker. The row is dir="ltr"
  // (see the user row above): the AI answer is ALWAYS on the LEFT,
  // avatar at the far left, in both RTL and LTR.
  return (
    <div
      dir="ltr"
      className="msg-in flex min-w-0 items-start gap-3"
      onPointerDown={onLpPointerDown}
      onPointerMove={onLpPointerMove}
      onPointerUp={cancelLpTimer}
      onPointerCancel={cancelLpTimer}
      onPointerLeave={cancelLpTimer}
      onContextMenu={onLpContextMenu}
    >
      {/* AI avatar frame (see globals.css .ai-avatar-frame):
          /avatar.jpg is the square founder portrait, shown whole
          (no zoom — founder order 2026-11-25). The typing video
          (/avatar-video.mp4, muted loop) plays ONLY while this answer
          is still streaming (isStreaming) — a finished reply is not
          typing any more, so completed replies (including the latest)
          show the static photo (owner, 2026-11-25). If the video
          fails, the photo shows instead. */}
      <span className="ai-avatar-frame mt-1 h-8 w-8 ring-1 ring-black/5 dark:ring-[var(--card-border)]">
        {isStreaming && !avatarVideoFailed ? (
          <video
            src="/avatar-video.mp4"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            onError={() => setAvatarVideoFailed(true)}
            className="ai-avatar-video"
          />
        ) : (
          <img src="/avatar.jpg" alt="" className="ai-avatar-img" />
        )}
      </span>
      <div ref={contentRef} className="min-w-0 flex-1 break-words">
        {msg.image && (
          <img
            src={msg.image}
            alt=""
            className="mb-2 block max-h-72 w-auto max-w-full rounded-2xl object-cover"
          />
        )}
        <div className="md-body" dir="auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Each paragraph/list item gets its own direction from its
              // first strong character (plaintext bidi, see globals.css),
              // so an English sentence inside a Pashto answer stays LTR
              // and its number/period lands in the right place.
              p({ children }: { children?: ReactNode }) {
                // A "Prompt:" paragraph becomes a prompt card (see
                // Markdown.tsx) — the prompt is the important part
                // of the answer and belongs in a box, like ChatGPT's.
                const text = plainTextOf(children).trim();
                const m = /^prompt:\s*/i.exec(text);
                if (m && text.length > m[0].length + 8) {
                  return <PromptCard text={text.slice(m[0].length).trim()} lang={lang} />;
                }
                return (
                  <p dir="auto" className="bidi-plaintext">
                    {children}
                  </p>
                );
              },
              blockquote({ children }: { children?: ReactNode }) {
                // A substantial quote becomes a prompt card too. The model
                // usually emits a requested prompt as a quote block under a
                // heading ("د پرامپټ نمونه (په انګلیسي):") rather than a
                // literal "Prompt:" paragraph, so the "Prompt:"-only trigger
                // missed it (preview test 2026-11-25). Only Latin-heavy
                // quotes become cards (prompt samples are English); a
                // Pashto/Dari quote stays a plain blockquote.
                const text = plainTextOf(children).trim();
                const latin = (text.match(/[A-Za-z]/g) || []).length;
                const arabic = (text.match(/[؀-ۿ]/g) || []).length;
                if (text.length > 40 && latin >= 20 && latin > arabic) {
                  return <PromptCard text={text} lang={lang} />;
                }
                return (
                  <blockquote dir="auto" className="bidi-plaintext">
                    {children}
                  </blockquote>
                );
              },
              li({ children }: { children?: ReactNode }) {
                return (
                  <li dir="auto" className="bidi-plaintext">
                    {children}
                  </li>
                );
              },
              code(props) {
                const { className, children } = props as {
                  className?: string;
                  children?: ReactNode;
                };
                const match = /language-(\w+)/.exec(className || "");
                const codeText = String(children ?? "").replace(/\n$/, "");
                const inline = !match && !codeText.includes("\n");
                if (inline) {
                  return (
                    <code className="rounded bg-[var(--surface-hover)] px-1 py-0.5 text-sm">
                      {codeText}
                    </code>
                  );
                }
                return (
                  <CodeBlock
                    codeLang={match?.[1] ?? ""}
                    code={codeText}
                    uiLang={lang}
                  />
                );
              },
              pre(props) {
                return <>{props.children}</>;
              },
            }}
          >
            {/* LaTeX math ($$...$$ / $...$) is converted to readable
                plain text first (see lib/mathText) — the raw
                "$$...$$" equation in a Gemini answer rendered
                literally before this. Code blocks and inline code
                are protected inside stripMathDelimiters. */}
            {stripMathDelimiters(msg.content)}
          </ReactMarkdown>
        </div>
        {msg.file && <FileCard file={msg.file} lang={lang} />}
        {/* Assistant action row (Round 3 item K, ChatGPT-style):
            icon-only buttons in EXACTLY this physical order — Copy,
            Like, Dislike, Read aloud, Share, ••• — in both RTL and
            LTR. The row is dir="ltr" (like the message row above),
            so flex cannot flip the order by language; Regenerate
            lives inside the ••• menu. (The long-message collapse was
            removed in R3 A+B, so there is no show-more toggle here.) */}
        <div dir="ltr" className="mt-1.5 flex flex-wrap items-center gap-1 px-1">
          <CopyButton text={msg.content} lang={lang} iconOnly />
          {reaction !== "dislike" && (
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => setReactionStored("like")}
              className={reaction === "like" ? actionIconBtnLiked : actionIconBtn}
              aria-label={t(lang, "like")}
              title={t(lang, "like")}
            >
              <Icon name="thumbsUp" size={16} />
            </button>
          )}
          {reaction !== "like" && (
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => setReactionStored("dislike")}
              className={reaction === "dislike" ? actionIconBtnLiked : actionIconBtn}
              aria-label={t(lang, "dislike")}
              title={t(lang, "dislike")}
            >
              <Icon name="thumbsDown" size={16} />
            </button>
          )}
          <SpeakButton text={msg.content} lang={lang} onNote={onNote} />
          <div className="relative">
            <button
              type="button"
              ref={shareBtnRef}
              disabled={actionsDisabled}
              onClick={shareMessage}
              className={actionIconBtn}
              aria-label={t(lang, "shareChat")}
              title={t(lang, "shareChat")}
            >
              <Icon name="share" size={16} />
            </button>
            {shareMenuJsx}
          </div>
          <div className="relative">
            <button
              type="button"
              ref={moreBtnRef}
              onClick={() => {
                setMoreOpen((v) => !v);
                setShareMenuOpen(false);
              }}
              className={actionIconBtn}
              aria-label={t(lang, "moreActions")}
              title={t(lang, "moreActions")}
            >
              <Icon name="dots" size={16} />
            </button>
            {moreOpen && (
              <>
                <button
                  type="button"
                  aria-label={t(lang, "closeMenu")}
                  onClick={() => {
                    setMoreOpen(false);
                  }}
                  className="fixed inset-0 z-20 cursor-default"
                />
                {/* Anchored to the ••• button: physical right-0 (the
                    row is dir="ltr", so this is the button's right
                    edge in both RTL and LTR), opening downward
                    (top-full); max-w keeps it inside narrow screens,
                    and moreMenuShift (see above) nudges it right only
                    when it would otherwise leave the left edge. */}
                <div
                  ref={moreMenuRef}
                  style={{
                    ...(moreMenuShift ? { right: -moreMenuShift } : {}),
                    ...(moreMenuMaxHeight ? { maxHeight: moreMenuMaxHeight } : {}),
                  }}
                  className={
                    moreMenuFlipUp
                      ? `absolute bottom-full right-0 z-30 mb-1 w-56 max-w-[90vw] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-md${moreMenuMaxHeight ? " overflow-y-auto" : ""}`
                      : `absolute right-0 top-full z-30 mt-1 w-56 max-w-[90vw] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-2 shadow-md${moreMenuMaxHeight ? " overflow-y-auto" : ""}`
                  }
                >
                  {isLastAssistant && onRegenerate && (
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        onRegenerate();
                      }}
                      className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
                    >
                      <Icon name="regenerate" size={14} className="me-2 inline-block align-middle" /> {t(lang, "regenerate")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onBranch?.(msg.id);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
                  >
                    <Icon name="branch" size={14} className="me-2 inline-block align-middle" /> {t(lang, "branchChat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onExport?.();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
                  >
                    <Icon name="download" size={14} className="me-2 inline-block align-middle" /> {t(lang, "exportChat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setFeedbackOpen(true);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-[var(--surface-hover)]"
                  >
                    <Icon name="flag" size={14} className="me-2 inline-block align-middle" /> {t(lang, "report")}
                  </button>
                  {/* The REAL model/mode used — never a made-up label.
                      Every answer is "AfghanGPT Auto" to the user; the
                      free-web answer carries its source note in the
                      text itself. No key is ever mentioned here. */}
                  <div className="mt-1 border-t border-[var(--border-subtle)] px-3 pb-1 pt-2 text-xs text-[var(--muted)]">
                    {t(lang, "usedModel").replace("{model}", modelUsed ?? t(lang, "modelAuto"))}
                  </div>
                </div>
              </>
            )}
          </div>
          {msg.image && (
            <>
              <a href={msg.image} download="afghangpt-image.png" className={actionBtn}>
                <Icon name="download" size={13} className="me-1 inline-block align-middle" /> {t(lang, "download")}
              </a>
              <SaveImageButton image={msg.image} lang={lang} />
            </>
          )}
          {msg.mode === "web" && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-900/60 dark:text-emerald-200 dark:ring-emerald-800">
              {t(lang, "modelAuto")}
            </span>
          )}
        </div>
        {/* "Share feedback" bottom sheet (ChatGPT-style): an Issue
            category + optional details + Submit. Reports are saved
            on this device only (REPORTS_KEY, max 50) — never sent
            anywhere; the sheet says so plainly below the button. */}
        {feedbackOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={t(lang, "shareFeedback")}>
            <button
              type="button"
              aria-label={t(lang, "closeMenu")}
              onClick={() => setFeedbackOpen(false)}
              className="absolute inset-0 cursor-default bg-black/50"
            />
            <div className="relative w-full max-w-lg rounded-t-3xl bg-[var(--card)] p-5 shadow-xl">
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--border-subtle)]" />
              <h2 className="text-center text-lg font-bold">{t(lang, "shareFeedback")}</h2>
              <label className="mt-4 block text-sm font-semibold">{t(lang, "feedbackIssue")}</label>
              <select
                value={feedbackCategory}
                onChange={(e) => setFeedbackCategory(e.target.value)}
                className="input-field mt-1 w-full"
              >
                <option value="wrong">{t(lang, "feedbackCatWrong")}</option>
                <option value="unsafe">{t(lang, "feedbackCatUnsafe")}</option>
                <option value="bug">{t(lang, "feedbackCatBug")}</option>
                <option value="other">{t(lang, "feedbackCatOther")}</option>
              </select>
              <textarea
                dir="auto"
                value={reportText}
                onChange={(e) => setReportText(e.target.value)}
                placeholder={t(lang, "feedbackDetails")}
                rows={4}
                className="input-field mt-3 w-full"
              />
              <button
                type="button"
                onClick={submitReport}
                className="mt-4 w-full rounded-full bg-[#2457FF] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#1a46d6]"
              >
                {t(lang, "feedbackSubmit")}
              </button>
              <p className="mt-3 text-center text-xs text-[var(--muted)]">{t(lang, "feedbackLocalNote")}</p>
            </div>
          </div>
        )}
        {lpMenuJsx}
      </div>
    </div>
  );
}
