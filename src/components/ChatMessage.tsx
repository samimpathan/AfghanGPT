"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t, type Lang } from "@/lib/i18n";
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
  mode?: "gemini" | "offline" | "refused" | "busy" | "image" | "file" | "provider";
  /** Which provider answered (when mode is "provider"). */
  provider?: string;
  /** Attached photo / generated image as a data URL. */
  image?: string;
  /** A real generated file (v3.2): downloaded from a data URL. */
  file?: { filename: string; mime: string; size: number; base64: string };
};

/** Long messages collapse to ~4 lines with a show more / less toggle. */
const LONG_MESSAGE_CHARS = 600;

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
  "rounded-full px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 disabled:opacity-40";
const actionBtnActive =
  "rounded-full bg-slate-200 px-2 py-1 text-xs font-bold text-slate-800 dark:bg-slate-700 dark:text-white";

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function CopyButton({ text, lang }: { text: string; lang: Lang }) {
  const [done, setDone] = useState(false);
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
      {done ? "✓ " + t(lang, "copied") : "⧉ " + t(lang, "copy")}
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
      {saved ? "✓ " + t(lang, "saved") : "♥ " + t(lang, "save")}
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
      className={speaking ? actionBtnActive : actionBtn}
      aria-label={t(lang, "speak")}
    >
      {speaking ? "■ " + t(lang, "stop") : "🔊 " + t(lang, "speak")}
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
    <div className="my-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100" dir="ltr">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-800 px-3 py-1.5 text-xs">
        <span>{codeLang || "code"}</span>
        <span className="flex gap-2">
          {(isWeb || isNoteLang) && (
            <button
              type="button"
              onClick={() => {
                if (isWeb) setShowPreview((v) => !v);
                else setShowNote((v) => !v);
              }}
              className="rounded bg-emerald-600 px-2 py-0.5 text-white hover:bg-emerald-500"
            >
              ▶ {t(uiLang, "run")}
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
            className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600"
          >
            {done ? "✓" : "Copy code"}
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto p-3 text-sm">
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
            <span>Preview</span>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="rounded bg-slate-700 px-2 py-0.5 hover:bg-slate-600"
            >
              ✕ {t(uiLang, "close")}
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
    <div className="my-2 flex items-center gap-3 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 dark:border-[#263550] dark:bg-[#111B30]">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2457FF] text-xl text-white">
        {isZip ? "🗜" : "📄"}
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
        ⬇ {t(lang, "downloadFile")}
      </a>
    </div>
  );
}

export default function ChatMessage({
  msg,
  lang,
  onRegenerate,
  isLastAssistant,
  onEditMessage,
  onDeleteMessage,
  onNote,
  onBranch,
  onExport,
  actionsDisabled,
}: {
  msg: UiMessage;
  lang: Lang;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
  onEditMessage?: (id: string, newText: string) => void;
  onDeleteMessage?: (id: string) => void;
  onNote?: (text: string) => void;
  onBranch?: (msgId: string) => void;
  onExport?: () => void;
  actionsDisabled?: boolean;
}) {
  const isUser = msg.role === "user";
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);
  const [expanded, setExpanded] = useState(false);
  const [reaction, setReaction] = useState<"like" | "dislike" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState("");
  const isLong = msg.content.length > LONG_MESSAGE_CHARS;

  useEffect(() => {
    setReaction(loadReactions()[msg.id] ?? null);
  }, [msg.id]);

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

  const shareMessage = async () => {
    const text = msg.content;
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      throw new Error("no share");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        onNote?.(t(lang, "copied"));
      } catch {
        // ignore
      }
    }
  };

  const submitReport = () => {
    try {
      const raw = localStorage.getItem(REPORTS_KEY);
      const list = raw ? (JSON.parse(raw) as { msgId: string; note: string; at: string }[]) : [];
      list.push({ msgId: msg.id, note: reportText.trim(), at: new Date().toISOString() });
      localStorage.setItem(REPORTS_KEY, JSON.stringify(list.slice(-50)));
    } catch {
      // ignore
    }
    setReportText("");
    setReportOpen(false);
    setMoreOpen(false);
    onNote?.(t(lang, "reportSent"));
  };

  if (isUser) {
    if (editing) {
      return (
        <div className="flex min-w-0">
          <div className="ml-auto min-w-0 w-[82%] max-w-[82%]">
            <textarea
              dir="auto"
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              className="bidi-plaintext w-full rounded-[20px] border-2 border-[#2457FF] bg-white px-4 py-3 text-[17px] text-[#111111] outline-none dark:bg-[#111B30] dark:text-[#EAF2FF]"
            />
            <div className="mt-1.5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className={actionBtn}
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="button"
                disabled={!editText.trim() || actionsDisabled}
                onClick={() => {
                  if (!editText.trim()) return;
                  onEditMessage?.(msg.id, editText.trim());
                  setEditing(false);
                }}
                className="rounded-full bg-[#2457FF] px-3 py-1 text-xs font-bold text-white disabled:opacity-40"
              >
                {t(lang, "save")}
              </button>
            </div>
          </div>
        </div>
      );
    }
    // Physical margins (ml-auto) — NOT justify-end — so the bubble stays on
    // the RIGHT even when the page is RTL (Pashto/Dari), like the video.
    // dir="auto" + unicode-bidi: plaintext lets each line pick its own
    // direction, so mixed Pashto/English text does not get jumbled.
    return (
      <div className="flex min-w-0">
        <div className="ml-auto min-w-0 max-w-[78%]">
          {msg.image && (
            <img
              src={msg.image}
              alt=""
              className="mb-2 ml-auto block max-h-56 w-auto max-w-full rounded-2xl object-cover"
            />
          )}
          <div
            className="break-words rounded-[28px] bg-[#ECECEC] px-[18px] py-3 text-[17px] leading-6 text-slate-900 dark:bg-[#2F2F2F] dark:text-[#EAF2FF]"
            dir="auto"
          >
            <p
              className={`bidi-plaintext whitespace-pre-wrap ${
                !expanded && isLong ? "clamp-4" : ""
              }`}
            >
              {msg.content}
            </p>
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-end gap-1.5 px-1">
            {isLong && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className={actionBtn}
              >
                {expanded ? t(lang, "readLess") : t(lang, "readMore")}
              </button>
            )}
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => {
                setEditText(msg.content);
                setEditing(true);
              }}
              className={actionBtn}
            >
              ✎ {t(lang, "edit")}
            </button>
            <CopyButton text={msg.content} lang={lang} />
            <button
              type="button"
              disabled={actionsDisabled}
              onClick={() => onDeleteMessage?.(msg.id)}
              className={`${actionBtn} text-red-600 dark:text-red-400`}
            >
              🗑 {t(lang, "delete")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Assistant: PLAIN TEXT (no bubble, Gemini/ChatGPT style) with a
  // small circular avatar at the start (ChatGPT-style) and the
  // action row underneath: like/dislike, regenerate, share, copy,
  // ••• (Branch / Export / Report), speaker.
  return (
    <div className="flex min-w-0 items-start gap-3">
      <img
        src="/avatar.jpg"
        alt=""
        className="mt-1 h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-[#263550]"
      />
      <div className="min-w-0 flex-1 break-words">
        {msg.image && (
          <img
            src={msg.image}
            alt=""
            className="mb-2 block max-h-72 w-auto max-w-full rounded-2xl object-cover"
          />
        )}
        <div className={`md-body ${!expanded && isLong ? "clamp-4" : ""}`} dir="auto">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Each paragraph/list item gets its own direction from its
              // first strong character (plaintext bidi, see globals.css),
              // so an English sentence inside a Pashto answer stays LTR
              // and its number/period lands in the right place.
              p({ children }: { children?: ReactNode }) {
                return (
                  <p dir="auto" className="bidi-plaintext">
                    {children}
                  </p>
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
                    <code className="rounded bg-slate-300 px-1 py-0.5 text-sm dark:bg-slate-700">
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
            {msg.content}
          </ReactMarkdown>
        </div>
        {msg.file && <FileCard file={msg.file} lang={lang} />}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 px-1">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={actionBtn}
            >
              {expanded ? t(lang, "readLess") : t(lang, "readMore")}
            </button>
          )}
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => setReactionStored("like")}
            className={reaction === "like" ? actionBtnActive : actionBtn}
            aria-label={t(lang, "like")}
          >
            👍
          </button>
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={() => setReactionStored("dislike")}
            className={reaction === "dislike" ? actionBtnActive : actionBtn}
            aria-label={t(lang, "dislike")}
          >
            👎
          </button>
          <CopyButton text={msg.content} lang={lang} />
          <SpeakButton text={msg.content} lang={lang} onNote={onNote} />
          <button
            type="button"
            disabled={actionsDisabled}
            onClick={shareMessage}
            className={actionBtn}
            aria-label={t(lang, "shareChat")}
          >
            ↗ {t(lang, "shareChat")}
          </button>
          {isLastAssistant && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className={actionBtn}
              aria-label={t(lang, "regenerate")}
            >
              ↻ {t(lang, "regenerate")}
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setMoreOpen((v) => !v);
                setReportOpen(false);
              }}
              className={actionBtn}
              aria-label="More actions"
            >
              •••
            </button>
            {moreOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => {
                    setMoreOpen(false);
                    setReportOpen(false);
                  }}
                  className="fixed inset-0 z-20 cursor-default"
                />
                <div className="absolute bottom-full z-30 mb-1 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg dark:border-[#263550] dark:bg-[#111B30]">
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onBranch?.(msg.id);
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    ⎇ {t(lang, "branchChat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      onExport?.();
                    }}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    ⬇ {t(lang, "exportChat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen((v) => !v)}
                    className="block w-full rounded-xl px-3 py-2 text-start text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    ⚑ {t(lang, "report")}
                  </button>
                  {reportOpen && (
                    <div className="mt-1 border-t border-slate-200 p-2 dark:border-slate-700">
                      <textarea
                        dir="auto"
                        value={reportText}
                        onChange={(e) => setReportText(e.target.value)}
                        placeholder={t(lang, "reportPlaceholder")}
                        rows={2}
                        className="w-full rounded-xl border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        disabled={!reportText.trim()}
                        onClick={submitReport}
                        className="mt-1.5 w-full rounded-full bg-[#2457FF] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                      >
                        {t(lang, "report")}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          {msg.image && (
            <>
              <a href={msg.image} download="samim-ai-image.png" className={actionBtn}>
                ⬇ {t(lang, "download")}
              </a>
              <SaveImageButton image={msg.image} lang={lang} />
            </>
          )}
          {msg.mode === "offline" && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              {t(lang, "offlineMode")}
            </span>
          )}
          {msg.mode === "gemini" && (
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
              {t(lang, "onlineMode")}
            </span>
          )}
          {msg.mode === "provider" && (
            <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs text-violet-800 dark:bg-violet-900 dark:text-violet-200">
              {msg.provider ?? "AI"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
