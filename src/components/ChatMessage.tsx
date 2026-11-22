"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { t, type Lang } from "@/lib/i18n";
import { isPashto } from "@/lib/offlineBrain";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "gemini" | "offline" | "refused";
};

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
      className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {done ? t(lang, "copied") : t(lang, "copy")}
    </button>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100" dir="ltr">
      <div className="flex items-center justify-between bg-slate-800 px-3 py-1.5 text-xs">
        <span>{lang || "code"}</span>
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
      </div>
      <pre className="overflow-x-auto p-3 text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function ChatMessage({
  msg,
  lang,
  onRegenerate,
  isLastAssistant,
}: {
  msg: UiMessage;
  lang: Lang;
  onRegenerate?: () => void;
  isLastAssistant?: boolean;
}) {
  const isUser = msg.role === "user";
  const rtl = isPashto(msg.content);

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-3xl px-4 py-2.5 text-slate-900 md:max-w-[70%]"
          style={{ background: "#A8B6CC" }}
          dir={rtl ? "rtl" : "ltr"}
        >
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] md:max-w-[85%]">
        <div
          className="rounded-3xl bg-[#EDEEF0] px-4 py-3 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
          dir={rtl ? "rtl" : "ltr"}
        >
          <div className="md-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
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
                  return <CodeBlock lang={match?.[1] ?? ""} code={codeText} />;
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
          <CopyButton text={msg.content} lang={lang} />
          {isLastAssistant && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              ↻ {t(lang, "regenerate")}
            </button>
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
