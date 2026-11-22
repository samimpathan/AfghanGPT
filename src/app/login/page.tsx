"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export default function LoginPage() {
  const { lang } = useUi();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/");
  }

  async function reset() {
    setError("");
    if (!supabase || !email) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) setError(error.message);
    else setError(t(lang, "resetSent"));
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Image
            src="/avatar.jpg"
            alt="Samim AI"
            width={88}
            height={88}
            className="mx-auto rounded-full object-cover ring-4 ring-[var(--brand2)]/20"
          />
          <h1 className="mt-4 text-2xl font-bold text-[var(--brand2)]">
            {t(lang, "appName")}
          </h1>
          <p className="mt-1 text-sm font-bold">{t(lang, "welcomeBack")}</p>
          <p className="text-sm text-[var(--muted)]">{t(lang, "login")}</p>
        </div>

        <div className="mt-6 rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-5 shadow-sm">
          {!isSupabaseConfigured && (
            <p className="mb-4 rounded-2xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              {t(lang, "setupNeeded")}
            </p>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="text-sm font-bold">
              {t(lang, "email")}
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="mt-1.5 w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm font-normal outline-none focus:border-[var(--brand2)]"
              />
            </label>
            <label className="text-sm font-bold">
              {t(lang, "password")}
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1.5 w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm font-normal outline-none focus:border-[var(--brand2)]"
              />
            </label>
            {error && (
              <p role="alert" className="rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-[var(--brand2)] py-2.5 font-bold text-white disabled:opacity-50"
            >
              {busy ? t(lang, "loading") : t(lang, "login")}
            </button>
          </form>
          <div className="mt-5 flex flex-col gap-2.5 border-t border-[var(--card-border)] pt-4 text-center text-sm">
            <button type="button" onClick={reset} className="font-bold text-[var(--brand2)] hover:underline">
              {t(lang, "forgotPassword")}
            </button>
            <Link href="/register" className="text-[var(--muted)] hover:underline">
              {t(lang, "noAccount")}
            </Link>
            <Link href="/" className="text-[var(--muted)] hover:underline">
              <span className="inline-block rtl:rotate-180">←</span> {t(lang, "backToChat")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
