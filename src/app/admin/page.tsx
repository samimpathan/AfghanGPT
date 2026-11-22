"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { isAdminEmail, ADMIN_EMAIL } from "@/lib/admin";
import { listChats, listMessages } from "@/lib/chats";

type Status = {
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
  geminiModel: string;
};

export default function AdminPage() {
  const { lang } = useUi();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [totalChats, setTotalChats] = useState<number | null>(null);
  const [totalMessages, setTotalMessages] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null;
      if (!user) {
        router.replace("/login");
        return;
      }
      setEmail(user.email ?? null);
      setName(
        (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          ""
      );
      if (isAdminEmail(user.email)) {
        const rows = await listChats(user.id);
        setTotalChats(rows.length);
        let count = 0;
        for (const row of rows) {
          const msgs = await listMessages(row.id);
          count += msgs.length;
        }
        setTotalMessages(count);
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json() as Promise<Status>)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-slate-950 dark:text-slate-100">
        <p className="text-sm text-slate-500">{t(lang, "loading")}</p>
      </div>
    );
  }

  // Not logged in: the effect above already redirects to /login.
  // If Supabase is not configured there is no session to check.
  if (!email) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4 dark:bg-slate-950 dark:text-slate-100">
        <div className="text-center">
          <p className="text-sm text-slate-500">{t(lang, "login")}</p>
          <Link href="/login" className="mt-4 inline-block font-bold text-[#2457FF] hover:underline">
            {t(lang, "login")}
          </Link>
        </div>
      </div>
    );
  }

  if (!isAdminEmail(email)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white px-4 dark:bg-slate-950 dark:text-slate-100">
        <div className="text-center">
          <p className="text-lg font-bold">{t(lang, "adminOnly")}</p>
          <Link href="/" className="mt-4 inline-block font-bold text-[#2457FF] hover:underline">
            ← {t(lang, "backToChat")}
          </Link>
        </div>
      </div>
    );
  }

  const supabaseOk = status ? status.supabaseConfigured : isSupabaseConfigured;
  const geminiOnline = status ? status.geminiConfigured : false;
  const geminiModel = status?.geminiModel ?? "gemini-3-flash-preview";

  return (
    <div className="min-h-dvh bg-white px-4 py-8 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-3">
          <Image src="/avatar.jpg" alt="Samim AI" width={56} height={56} className="rounded-full object-cover" />
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              {t(lang, "adminDashboard")}
              <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-black">
                {t(lang, "admin")}
              </span>
            </h1>
            <p className="text-sm text-slate-500">
              {name || "عبدالصمیم نیازی"} • {email}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-5 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-bold">{t(lang, "appStatus")}</h2>
            <div className="mt-2 flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span>Supabase</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                  {supabaseOk ? t(lang, "connected") : t(lang, "notConfigured")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>
                  Gemini • {geminiModel}
                </span>
                <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                  {geminiOnline ? t(lang, "online") : t(lang, "offline")}
                </span>
              </div>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-bold">{t(lang, "accountInfo")}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-2xl bg-slate-100 px-3 py-4 dark:bg-slate-800">
                <p className="text-2xl font-bold">{totalChats ?? "—"}</p>
                <p className="text-xs text-slate-500">{t(lang, "totalChats")}</p>
              </div>
              <div className="rounded-2xl bg-slate-100 px-3 py-4 dark:bg-slate-800">
                <p className="text-2xl font-bold">{totalMessages ?? "—"}</p>
                <p className="text-xs text-slate-500">{t(lang, "totalMessages")}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t(lang, "adminNote")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <a
              href="https://supabase.com/dashboard/project/kmofyrkgwpgqztcggtaq/sql/new"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-[#2457FF] px-3 py-2.5 text-center text-sm font-bold text-white"
            >
              {t(lang, "openSupabase")} ↗
            </a>
            <a
              href="https://vercel.com/samimpatan8-8864/samim-ai/settings/environment-variables"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-center text-sm font-bold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {t(lang, "openVercel")} ↗
            </a>
            <a
              href="https://github.com/samimpathan/SamimAI"
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-center text-sm font-bold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {t(lang, "openGithub")} ↗
            </a>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-400">
          {t(lang, "admin")} • {ADMIN_EMAIL} • Samim AI
        </p>
        <Link href="/" className="mt-6 inline-block text-sm text-[#2457FF] hover:underline">
          ← {t(lang, "backToChat")}
        </Link>
      </div>
    </div>
  );
}
