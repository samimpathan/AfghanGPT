"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";

/**
 * /share/[id] — read-only view of a chat the owner shared publicly.
 * Reads ONLY the shared_chats table (public SELECT policy). If the
 * table does not exist yet (studio-001.sql not run) or the id is
 * unknown, it says so honestly — it never invents a chat.
 */
export default function SharePage({ params }: { params: { id: string } }) {
  const { lang } = useUi();
  const [state, setState] = useState<"loading" | "found" | "missing">("loading");
  const [title, setTitle] = useState("");
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);

  useEffect(() => {
    if (!supabase) {
      setState("missing");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from("shared_chats")
          .select("title, messages")
          .eq("id", params.id)
          .single();
        if (cancelled) return;
        if (error || !data) {
          setState("missing");
          return;
        }
        const row = data as {
          title?: string;
          messages?: { role: string; content: string }[];
        };
        setTitle(row.title ?? "");
        setMessages(Array.isArray(row.messages) ? row.messages : []);
        setState("found");
      } catch {
        if (!cancelled) setState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  return (
    <div className="min-h-dvh bg-[var(--background)] px-3 py-4 text-[var(--foreground)] sm:px-4">
      <div className="mx-auto max-w-2xl space-y-4">
        <header className="space-y-1">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
            <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" />
            Samim AI
          </Link>
          <p className="text-xs font-bold text-[var(--muted)]">
            Samim AI • {t(lang, "sharedChat")}
          </p>
        </header>
        {state === "loading" && (
          <p className="mt-6 text-sm text-[var(--muted)]">{t(lang, "loading")}</p>
        )}
        {state === "missing" && (
          <div className="mt-6">
            <p className="text-sm text-[var(--muted)]">{t(lang, "sharedNotFound")}</p>
            <Link href="/" className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--brand2)] hover:underline">
              <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" />
              Samim AI
            </Link>
          </div>
        )}
        {state === "found" && (
          <div className="mt-4">
            <h1 className="text-xl font-bold sm:text-2xl">{title || t(lang, "sharedChat")}</h1>
            <p className="mt-1 text-xs text-[var(--muted)]">{t(lang, "sharedBy")}</p>
            <div className="mt-6 flex flex-col gap-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "max-w-[85%] self-end rounded-2xl bg-[#ECECEC] px-4 py-2.5 text-sm dark:bg-[#2F2F2F]"
                      : "max-w-[85%] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-2.5 text-sm"
                  }
                >
                  <p className="mb-1 text-[11px] font-bold text-[var(--muted)]">
                    {m.role === "user" ? "You" : "Samim AI"}
                  </p>
                  <p className="bidi-plaintext whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              ))}
            </div>
            <Link href="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--brand2)] hover:underline">
              <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" />
              Samim AI
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
