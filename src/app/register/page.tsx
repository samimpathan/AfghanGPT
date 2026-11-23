"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Btn, Card, Field, Input } from "@/components/ui";
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
      setError(t(lang, "passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      setError(t(lang, "passwordTooShort"));
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
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2457FF] text-white shadow-sm">
            <Icon name="sparkles" size={28} />
          </span>
          <h1 className="mt-4 text-2xl font-bold">{t(lang, "appShort")}</h1>
          <p className="mt-1 text-sm font-bold">{t(lang, "createAccount")}</p>
          <p className="text-sm text-[var(--muted)]">{t(lang, "createAccountSubtitle")}</p>
        </div>

        <Card className="mt-6 p-5">
          {!isSupabaseConfigured && (
            <p className="mb-4 rounded-2xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              {t(lang, "setupNeeded")}
            </p>
          )}
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label={t(lang, "fullName")}>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </Field>
            <Field label={t(lang, "email")}>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Field>
            <Field label={t(lang, "password")}>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field label={t(lang, "confirmPassword")}>
              <Input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            {error && (
              <p role="alert" className="rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            )}
            <Btn type="submit" disabled={busy} className="min-h-11 w-full">
              {busy ? t(lang, "loading") : t(lang, "createAccount")}
            </Btn>
          </form>
          <div className="mt-5 flex flex-col gap-2.5 border-t border-[var(--card-border)] pt-4 text-center text-sm">
            <Link href="/login" className="min-h-11 text-[var(--muted)] hover:underline">
              {t(lang, "haveAccount")}
            </Link>
            <Link href="/" className="min-h-11 text-[var(--muted)] hover:underline">
              <Icon name="arrowLeft" size={16} className="me-1 inline-block align-middle rtl:rotate-180" /> {t(lang, "backToChat")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
