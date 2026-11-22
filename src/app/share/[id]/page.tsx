"use client";

import { useEffect, useState } from "react";
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
    <div className="min-h-dvh bg-white px-4 py-8 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-bold text-slate-500">
          Samim AI • {t(lang, "sharedChat")}
        </p>
        {state === "loading" && (
          <p className="mt-6 text-sm text-slate-500">{t(lang, "loading")}</p>
        )}
        {state === "missing" && (
          <div className="mt-6">
            <p className="text-sm text-slate-500">{t(lang, "sharedNotFound")}</p>
            <Link href="/" className="mt-4 inline-block text-sm font-bold text-[#2457FF] hover:underline">
              ← Samim AI
            </Link>
          </div>
        )}
        {state === "found" && (
          <div className="mt-4">
            <h1 className="text-xl font-bold">{title || t(lang, "sharedChat")}</h1>
            <p className="mt-1 text-xs text-slate-500">{t(lang, "sharedBy")}</p>
            <div className="mt-6 flex flex-col gap-4">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "self-end rounded-2xl bg-slate-200 px-4 py-2.5 text-sm dark:bg-slate-800"
                      : "rounded-2xl bg-slate-100 px-4 py-2.5 text-sm dark:bg-slate-900"
                  }
                >
                  <p className="mb-1 text-[11px] font-bold text-slate-500">
                    {m.role === "user" ? "You" : "Samim AI"}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>
              ))}
            </div>
            <Link href="/" className="mt-8 inline-block text-sm font-bold text-[#2457FF] hover:underline">
              ← Samim AI
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
