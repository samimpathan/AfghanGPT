"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";

export default function RegisterPage() {
  const { lang } = useUi();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(lang === "ps" ? "پاسورډونه سره نه دي برابر." : lang === "fa" ? "رمزها با هم برابر نیستند." : "Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError(lang === "ps" ? "پاسورډ باید لږ تر لږه ۶ توري وي." : lang === "fa" ? "رمز باید حداقل ۶ حرف باشد." : "Password must be at least 6 characters.");
      return;
    }
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Anyone can register — no student-only restriction, no invite.
    router.push("/");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-4 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <Image src="/avatar.jpg" alt="Samim AI" width={80} height={80} className="mx-auto rounded-full object-cover" />
          <h1 className="mt-3 text-xl font-bold">{t(lang, "appName")}</h1>
          <p className="text-sm text-slate-500">{t(lang, "register")}</p>
        </div>
        {!isSupabaseConfigured && (
          <p className="mt-4 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {t(lang, "setupNeeded")}
          </p>
        )}
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label className="text-sm">
            {t(lang, "fullName")}
            <input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" />
          </label>
          <label className="text-sm">
            {t(lang, "email")}
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" />
          </label>
          <label className="text-sm">
            {t(lang, "password")}
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" />
          </label>
          <label className="text-sm">
            {t(lang, "confirmPassword")}
            <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800" />
          </label>
          {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
          <button type="submit" disabled={busy} className="rounded-xl bg-[#2457FF] py-2.5 font-bold text-white disabled:opacity-50">
            {t(lang, "createAccount")}
          </button>
        </form>
        <div className="mt-4 flex flex-col gap-2 text-center text-sm">
          <Link href="/login" className="text-slate-600 hover:underline dark:text-slate-300">
            {t(lang, "haveAccount")}
          </Link>
          <Link href="/" className="text-slate-500 hover:underline">
            ← {t(lang, "backToChat")}
          </Link>
        </div>
      </div>
    </div>
  );
}
