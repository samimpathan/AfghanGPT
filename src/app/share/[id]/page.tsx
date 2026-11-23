"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";
import { Card, Spinner } from "@/components/ui";

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
    <AppShell
      title={title || t(lang, "sharedChat")}
      subtitle={state === "found" ? t(lang, "sharedBy") : undefined}
      icon="share"
    >
      <div className="space-y-4">
        {state === "loading" && (
          <Card className="flex justify-center py-10">
            <Spinner label={t(lang, "loading")} />
          </Card>
        )}
        {state === "missing" && (
          <Card className="flex flex-col items-center gap-3 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
              <Icon name="search" size={24} />
            </span>
            <p className="text-sm text-[var(--muted)]">{t(lang, "sharedNotFound")}</p>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#2457FF] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a46d6] active:scale-95 dark:bg-[#3b82f6] dark:hover:bg-[#2563eb]"
            >
              <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" />
              AfghanGPT
            </Link>
          </Card>
        )}
        {state === "found" && (
          <div>
            <div className="flex flex-col gap-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "max-w-[85%] self-end rounded-2xl bg-[var(--bubble-user)] px-4 py-2.5 text-sm"
                      : "max-w-[85%] rounded-2xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-2.5 text-sm"
                  }
                >
                  <p className="mb-1 text-[11px] font-bold text-[var(--muted)]">
                    {m.role === "user" ? "You" : "AfghanGPT"}
                  </p>
                  <p className="bidi-plaintext whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              ))}
              {messages.length === 0 && (
                <Card className="flex flex-col items-center gap-2 py-8 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
                    <Icon name="share" size={24} />
                  </span>
                  <p className="text-sm text-[var(--muted)]">{t(lang, "empty")}</p>
                </Card>
              )}
            </div>
            <Link href="/" className="mt-8 inline-flex items-center gap-1.5 text-sm font-bold text-[var(--brand2)] hover:underline">
              <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" />
              AfghanGPT
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}
