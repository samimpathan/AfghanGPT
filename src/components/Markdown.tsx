/**
 * components/Markdown.tsx — markdown with code blocks (copy button)
 * and ChatGPT-style "Prompt:" cards.
 * No syntax-highlighting dependency — code is shown in a dark block
 * with the language label and a working Copy button. A paragraph
 * that starts with "Prompt:" (as in the owner's ChatGPT screenshots)
 * renders as a bordered prompt card with its own Copy button, so
 * the important part of an answer stands out in a box.
 */
"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { t, type Lang } from "@/lib/i18n";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripMathDelimiters } from "@/lib/mathText";

/** Plain text of a ReactMarkdown children tree (for the Copy
 * button and the "Prompt:" prefix check). Recurses into elements
 * so **Prompt:** (bold) is detected the same as plain text. */
export function plainTextOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainTextOf).join("");
  if (typeof node === "object" && "props" in node) {
    const el = node as { props?: { children?: ReactNode } };
    return plainTextOf(el.props?.children);
  }
  return "";
}

/** ChatGPT-style prompt card: a bordered box with a "Prompt"
 * header + Copy button, body in the app's card colours (works in
 * light and dark). Used for paragraphs starting with "Prompt:". */
export function PromptCard({ text, lang }: { text: string; lang: Lang }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--card)] shadow-sm" dir="ltr">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--card-border)] bg-[var(--surface)] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
          <Icon name="fileText" size={13} />
          {t(lang, "promptLabel")}
        </span>
        <button
          type="button"
          className="flex shrink-0 items-center rounded-lg bg-[var(--surface-hover)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)] transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-cyan-300 active:scale-95"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? (
            <>
              <Icon name="check" size={13} className="me-1 inline-block align-middle" />
              {t(lang, "copied")}
            </>
          ) : (
            <>
              <Icon name="copy" size={13} className="me-1 inline-block align-middle" />
              {t(lang, "copy")}
            </>
          )}
        </button>
      </div>
      <p className="whitespace-pre-wrap px-3 py-2.5 text-[14px] leading-relaxed text-[var(--foreground)]">{text}</p>
    </div>
  );
}

function CodeBlock({ lang, code, uiLang }: { lang: string; code: string; uiLang: Lang }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[#0d1426] shadow-sm" dir="ltr">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
        <span className="truncate text-xs font-semibold text-cyan-300">{lang || "code"}</span>
        <button
          type="button"
          className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-cyan-300 active:scale-95"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard unavailable */
            }
          }}
        >
          {copied ? (<><Icon name="check" size={13} className="me-1 inline-block align-middle" />{t(uiLang, "copied")}</>) : (<><Icon name="copy" size={13} className="me-1 inline-block align-middle" />{t(uiLang, "copy")}</>)}
        </button>
      </div>
      <pre className="overflow-x-auto !m-0 !bg-transparent p-3 text-[13px] leading-relaxed">
        <code className="bg-transparent font-mono text-slate-100 !p-0">{code}</code>
      </pre>
    </div>
  );
}

export default function Markdown({ text, lang = "ps" }: { text: string; lang?: Lang }) {
  return (
    <div className="md-body bidi-plaintext text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p({ children }: { children?: ReactNode }) {
            // A "Prompt:" paragraph becomes a prompt card (see
            // above) — the prompt is the important part of the
            // answer and belongs in a box, like ChatGPT's.
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
            const langName = (className ?? "").replace("language-", "");
            return <CodeBlock lang={langName} code={raw.replace(/\n$/, "")} uiLang={lang} />;
          },
          img({ src, alt }) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt={alt ?? ""} loading="lazy" className="max-w-full rounded-xl shadow-sm" />
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {/* LaTeX math ($$...$$ / $...$) is converted to readable
            plain text first (see lib/mathText) — raw "$$" in a chat
            bubble is worse than a plain equation. Code blocks and
            inline code are protected inside stripMathDelimiters. */}
        {stripMathDelimiters(text)}
      </ReactMarkdown>
    </div>
  );
}
