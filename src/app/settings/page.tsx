"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/Providers";
import { t, LANGS, type Lang } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";

export default function SettingsPage() {
  const { lang, setLang, theme, setTheme } = useUi();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, []);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    try {
      localStorage.removeItem("samim-ai-guest-chats");
    } catch {
      // ignore
    }
    router.push("/");
  }

  function clearHistory() {
    try {
      localStorage.removeItem("samim-ai-guest-chats");
    } catch {
      // ignore
    }
    setNote(t(lang, "historyCleared"));
  }

  return (
    <div className="min-h-dvh bg-white px-4 py-8 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-3">
          <Image src="/avatar.jpg" alt="Samim AI" width={56} height={56} className="rounded-full object-cover" />
          <div>
            <h1 className="text-xl font-bold">{t(lang, "settings")}</h1>
            <p className="text-sm text-slate-500">{t(lang, "appName")} • Samim AI</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-5 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "language")}</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as Lang)}
              className="rounded-full border border-slate-300 bg-transparent px-3 py-1.5 dark:border-slate-700"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "theme")}</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              className="rounded-full border border-slate-300 bg-transparent px-3 py-1.5 dark:border-slate-700"
            >
              <option value="light">{t(lang, "light")}</option>
              <option value="dark">{t(lang, "dark")}</option>
            </select>
          </label>

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "modelInfo")}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              gemini-3-flash-preview (free tier) + offline brain
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "accountInfo")}</span>
            <span className="text-slate-500">{email ?? "—"}</span>
          </div>

          <button
            type="button"
            onClick={clearHistory}
            className="rounded-xl border border-red-300 px-3 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            {t(lang, "clearHistory")}
          </button>

          {note && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {note}
            </p>
          )}

          {email ? (
            <button
              type="button"
              onClick={logout}
              className="rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-bold text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {t(lang, "logout")}
            </button>
          ) : (
            <Link href="/login" className="rounded-xl bg-[#2457FF] px-3 py-2.5 text-center text-sm font-bold text-white">
              {t(lang, "login")}
            </Link>
          )}
        </div>

        <Link href="/" className="mt-6 inline-block text-sm text-[#2457FF] hover:underline">
          ← {t(lang, "backToChat")}
        </Link>
      </div>
    </div>
  );
}
