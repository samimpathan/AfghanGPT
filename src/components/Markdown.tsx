/**
 * components/Markdown.tsx — markdown with code blocks (copy button).
 * No syntax-highlighting dependency — code is shown in a dark block
 * with the language label and a working Copy button.
 */
"use client";

import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/10 bg-[#0d1426]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="text-xs font-semibold text-cyan-300">{lang || "code"}</span>
        <button
          type="button"
          className="rounded-lg bg-white/10 px-2 py-1 text-xs font-semibold text-white active:scale-95"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="!m-0 !bg-transparent !p-3">
        <code className="!bg-transparent !p-0">{code}</code>
      </pre>
    </div>
  );
}

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="md-body bidi-plaintext text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }: { children?: ReactNode }) {
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const raw = String(children ?? "");
            const isBlock = /language-/.test(className ?? "") || raw.includes("\n");
            if (!isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            const lang = (className ?? "").replace("language-", "");
            return <CodeBlock lang={lang} code={raw.replace(/\n$/, "")} />;
          },
          img({ src, alt }) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ""} className="max-w-full rounded-xl" />
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
