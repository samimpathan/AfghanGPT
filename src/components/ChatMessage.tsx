"use client";

import { useEffect, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t, type Lang } from "@/lib/i18n";
import {
  isSpeechSynthesisSupported,
  speakText,
  stopSpeaking,
} from "@/lib/voice";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "gemini" | "offline" | "refused";
  /** Attached photo / generated image as a data URL. */
  image?: string;
};

/** Long messages collapse to ~4 lines with a show more / less toggle. */
const LONG_MESSAGE_CHARS = 600;

const actionBtn =
  "rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-40";

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
    >
      {done ? t(lang, "copied") : t(lang, "copy")}
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

/** Read an assistant reply aloud (Web Speech API, free, no key). */
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
  useEffect(() => () => stopSpeaking(), []);
  const toggle = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    if (!isSpeechSynthesisSupported()) {
      onNote?.(t(lang, "speechNotSupported"));
      return;
    }
    const ok = speakText(text, lang, () => setSpeaking(false));
    if (!ok) {
      onNote?.(t(lang, "speechNotSupported"));
      return;
    }
    setSpeaking(true);
  };
  return (
    <button type="button" onClick={toggle} className={actionBtn}>
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

export default function ChatMessage({
  msg,
  lang,
  onRegenerate,
  isLastAssistant,
  onEditMessage,
  onDeleteMessage,
  onNote,
  actionsDisabled,
}: {
  msg: UiMessage;
  lang: Lang;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
  onEditMessage?: (id: string, newText: string) => void;
  onDeleteMessage?: (id: string) => void;
  onNote?: (text: string) => void;
  actionsDisabled?: boolean;
}) {
  const isUser = msg.role === "user";
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);
  const [expanded, setExpanded] = useState(false);
  const isLong = msg.content.length > LONG_MESSAGE_CHARS;

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
            className="break-words rounded-[28px] px-[18px] py-3 text-[17px] leading-6 text-[#111111]"
            style={{ background: "#A8B6CC" }}
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

  return (
    <div className="flex min-w-0">
      <div className="mr-auto min-w-0 max-w-[82%] break-words md:max-w-[85%]">
        <div
          className="rounded-[28px] bg-[#EDEEF0] px-[18px] py-3 text-slate-900 dark:bg-[#111B30] dark:text-[#EAF2FF]"
          dir="auto"
        >
          {msg.image && (
            <img
              src={msg.image}
              alt=""
              className="mb-2 block max-h-72 w-auto max-w-full rounded-2xl object-cover"
            />
          )}
          <div className={`md-body ${!expanded && isLong ? "clamp-4" : ""}`}>
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
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={actionBtn}
            >
              {expanded ? t(lang, "readLess") : t(lang, "readMore")}
            </button>
          )}
          <CopyButton text={msg.content} lang={lang} />
          <SpeakButton text={msg.content} lang={lang} onNote={onNote} />
          {isLastAssistant && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className={actionBtn}
            >
              ↻ {t(lang, "regenerate")}
            </button>
          )}
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
        </div>
      </div>
    </div>
  );
}
