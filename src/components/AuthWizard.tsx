/**
 * components/AuthWizard.tsx — the ONE "Log in or sign up" flow.
 *
 * Reference-style steps, AfghanGPT branding only (official logo lockup
 * — never any other brand's logo or name):
 *
 *   email    — Email field + Continue; OR; Continue with Google;
 *              Continue with phone.
 *   checkEmail — LINK-FLOW (email only, owner decision 2026-11-24):
 *              after signInWithOtp succeeds the user is told to
 *              check their inbox and click the sign-in link. NO
 *              6-digit code input for email. Resend link (same 30s
 *              cooldown), "use a different email" back to the email
 *              step, a spam hint, and Continue with password.
 *   phone    — Country/Region FIRST (default Afghanistan +93), then
 *              the phone number; Continue; OR; Google; email.
 *   code     — 6-digit OTP code (SMS ONLY — the phone path). Resend;
 *              OR; Google; Continue with password (existing
 *              password accounts, e.g. the founder's).
 *   password — email + password sign-in for existing accounts,
 *              with a forgot-password reset link.
 *   profile  — Full name + Age, saved to the Auth user's
 *              user_metadata (NO migration, NO new table). Shown
 *              whenever the signed-in account has no full name or
 *              age yet — i.e. every new OTP/Google account, never
 *              for existing complete accounts.
 *
 * Real Supabase Auth only — no fake auth:
 *   email LINK signInWithOtp({ email, options: { emailRedirectTo:
 *              origin + "/auth/callback" } }) — the emailed link
 *              lands on /auth/callback, which routes new users to
 *              the profile step and returning users into the app.
 *              (The free Supabase project cannot edit the email
 *              template, so there is no 6-digit email code anymore:
 *              the default template sends the sign-in link via
 *              {{ .ConfirmationURL }} and /auth/callback exchanges
 *              it for a session. The 6-digit code survives only on
 *              the phone path, as an SMS code.)
 *   phone OTP  signInWithOtp({ phone: E.164 }) + verifyOtp type "sms"
 *   Google     signInWithOAuth({ provider: "google" }) → the user
 *              picks an account (or types a Gmail) on GOOGLE'S OWN
 *              sign-in page, then /auth/callback finishes the
 *              session. There is deliberately NO in-app Google
 *              account picker — that picker belongs to Google.
 *
 * HONEST LIMITS (shown in the UI, never faked):
 *   - Phone SMS cannot arrive until an SMS provider (e.g. Twilio)
 *     is configured in the Supabase dashboard (owner's action,
 *     possibly paid/trial). Without it Supabase returns an error
 *     and the wizard shows smsNotConfigured.
 *   - Google sign-in cannot work until a Google Cloud OAuth client
 *     is created and the provider is enabled in Supabase (owner's
 *     action). Without it Supabase returns "provider is not
 *     enabled" and the wizard shows googleNotConfigured.
 *   - Email link: emailRedirectTo points at /auth/callback so a
 *     link click still lands here (the redirect allow list must
 *     include this app's domain).
 *
 * Re-login: the same email/phone/Google re-opens the SAME Auth
 * account, so the same user id — and the chats already persisted
 * in Supabase ai_chats/ai_messages under that id — load on home.
 * Chat persistence is NOT re-implemented here.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Btn, Card, Field, Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useUi } from "@/components/Providers";
import { t, type Lang } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { store } from "@/lib/store";
import { COUNTRY_DIALS, DEFAULT_DIAL, toE164 } from "@/lib/countries";

type Step = "email" | "phone" | "checkEmail" | "code" | "password" | "profile";
type Channel = "email" | "phone";

const RESEND_COOLDOWN_S = 30;

/** The multicolour Google "G" brand mark for the Google button
 * (a brand mark, not a UI-chrome line icon — the reference button
 * shows it, and the button must be recognisable as Google's). */
function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.98 11.98 0 0 0 12 0 11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

/** Map the known "provider not configured" failures to a clear
 * translated message; anything else is shown as Supabase sent it
 * (the existing login/register pattern). Returns null when there
 * is no error to map. */
function friendlyError(message: string, lang: Lang): string | null {
  const m = message.toLowerCase();
  if (/sms|phone/.test(m) && /(not configured|not enabled|disabled|provider)/.test(m))
    return t(lang, "smsNotConfigured");
  if (/provider is not enabled|oauth.*not enabled|google.*not enabled/.test(m))
    return t(lang, "googleNotConfigured");
  if (/email.*(disabled|not allowed)|signup.*disabled|signups not allowed/.test(m))
    return t(lang, "emailOtpNotConfigured");
  return null;
}

function profileComplete(meta: Record<string, unknown>): boolean {
  const name = meta.full_name;
  const age = meta.age;
  return (
    typeof name === "string" &&
    name.trim().length > 0 &&
    typeof age === "number" &&
    age >= 1 &&
    age <= 120
  );
}

export default function AuthWizard() {
  const { lang } = useUi();
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [channel, setChannel] = useState<Channel>("email");
  const [email, setEmail] = useState("");
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Resend cooldown countdown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Already signed in? Complete accounts go straight home; accounts
  // missing a name/age land on the profile step. The OAuth callback
  // also routes here with ?step=profile. ?step= also deep-links
  // email/phone/password/profile — handy for support. ?step=code is
  // routed to the email step: the code step is phone-only now and
  // needs a phone number first, and email has no code step anymore
  // (link flow), so a bare code deep-link has no valid target.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("step");
    if (
      param === "email" ||
      param === "phone" ||
      param === "password" ||
      param === "profile"
    ) {
      setStep(param);
    } else if (param === "code") {
      setStep("email");
    }
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) return;
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
      if (profileComplete(meta)) {
        router.push("/");
        return;
      }
      if (typeof meta.full_name === "string") setFullName(meta.full_name);
      if (typeof meta.age === "number") setAge(String(meta.age));
      setStep("profile");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ?step= in sync with the visible step (replaceState: no new
  // history entry, no re-render, no router side effects) so a refresh
  // reopens the SAME step instead of the stale mount-time one — e.g.
  // back from password used to leave ?step=password behind while the
  // wizard showed checkEmail. "checkEmail" is deliberately NOT
  // deep-linkable on mount: after a refresh the entered email is gone
  // from state, so that param falls back to the email step.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("step", step);
      window.history.replaceState(null, "", url.toString());
    } catch {
      // URL sync is best-effort; the wizard works without it.
    }
  }, [step]);

  function fail(message: string) {
    setError(friendlyError(message, lang) ?? message);
  }

  function targetOf(): string {
    return channel === "email" ? email : toE164(dial, phone) ?? phone;
  }

  async function sendOtp(ch: Channel) {
    setError("");
    setInfo("");
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return false;
    }
    setBusy(true);
    let err: { message: string } | null = null;
    if (ch === "email") {
      const res = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      err = res.error;
    } else {
      const e164 = toE164(dial, phone);
      if (!e164) {
        setBusy(false);
        setError(t(lang, "invalidPhone"));
        return false;
      }
      const res = await supabase.auth.signInWithOtp({ phone: e164 });
      err = res.error;
    }
    setBusy(false);
    if (err) {
      fail(err.message);
      return false;
    }
    setChannel(ch);
    setCode("");
    // Email is LINK-FLOW: no code step, the user clicks the link in
    // their inbox. Phone keeps the 6-digit SMS code step.
    setStep(ch === "email" ? "checkEmail" : "code");
    setCooldown(RESEND_COOLDOWN_S);
    return true;
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t(lang, "invalidEmail"));
      return;
    }
    await sendOtp("email");
  }

  async function submitPhone(e: React.FormEvent) {
    e.preventDefault();
    if (!toE164(dial, phone)) {
      setError(t(lang, "invalidPhone"));
      return;
    }
    await sendOtp("phone");
  }

  /** Phone-only code step: the email path never reaches here
   * (link flow). Defensive guard — if somehow reached with the
   * email channel, route back to the email step instead of
   * verifying an email code that no longer exists. */
  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (channel !== "phone") {
      setStep("email");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError(t(lang, "invalidCode"));
      return;
    }
    setError("");
    setInfo("");
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({
      phone: targetOf(),
      token: code.trim(),
      type: "sms",
    });
    setBusy(false);
    if (error) {
      fail(error.message);
      return;
    }
    await afterSignIn();
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      fail(error.message);
      return;
    }
    await afterSignIn();
  }

  async function submitProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(t(lang, "nameRequired"));
      return;
    }
    const n = Number(age);
    if (!Number.isInteger(n) || n < 1 || n > 120) {
      setError(t(lang, "invalidAge"));
      return;
    }
    setError("");
    setInfo("");
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName.trim(), age: n },
    });
    setBusy(false);
    if (error) {
      fail(error.message);
      return;
    }
    // The header reads Settings displayName first, then
    // user_metadata.full_name — keep both in sync so the name
    // shows everywhere immediately (Settings, header, drawer).
    try {
      const s = store.settings();
      store.saveSettings({ ...s, displayName: fullName.trim() });
    } catch {
      // local settings are best-effort; the metadata is the source
    }
    router.push("/");
  }

  /** After any successful sign-in: complete profile → home,
   * otherwise the profile step (prefilled with what we have). */
  async function afterSignIn() {
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    const meta = (data.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (profileComplete(meta)) {
      router.push("/");
      return;
    }
    if (typeof meta.full_name === "string") setFullName(meta.full_name);
    if (typeof meta.age === "number") setAge(String(meta.age));
    setStep("profile");
  }

  async function google() {
    setError("");
    setInfo("");
    if (!supabase) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      // "provider is not enabled" is the honest no-OAuth-client
      // state; anything else is shown as Supabase sent it.
      setError(friendlyError(error.message, lang) ?? t(lang, "googleSignInFailed"));
    }
    // On success the browser leaves for Google's own sign-in page.
  }

  async function resend() {
    if (cooldown > 0 || busy) return;
    const ok = await sendOtp(channel);
    if (ok) setInfo(t(lang, channel === "email" ? "linkResent" : "codeResent"));
  }

  async function resetPassword() {
    setError("");
    setInfo("");
    if (!supabase || !email) {
      setError(t(lang, "setupNeeded"));
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) fail(error.message);
    else setInfo(t(lang, "resetSent"));
  }

  function backStep() {
    setError("");
    setInfo("");
    if (step === "phone") setStep("email");
    else if (step === "checkEmail") setStep("email");
    else if (step === "code") setStep("phone");
    else if (step === "password") setStep(channel === "email" ? "checkEmail" : "code");
  }

  const title =
    step === "checkEmail"
      ? t(lang, "checkEmailTitle")
      : step === "code"
        ? t(lang, "codeTitlePhone")
        : step === "password"
          ? t(lang, "passwordStepTitle")
          : step === "profile"
            ? t(lang, "lastStepAge")
            : t(lang, "loginOrSignup");
  const subtitle =
    step === "checkEmail"
      ? email
        ? t(lang, "linkSentTo").replace("{target}", email)
        : t(lang, "loginSubtitle")
      : step === "code"
        ? targetOf()
          ? t(lang, "codeSentTo").replace("{target}", targetOf())
          : t(lang, "codeStepHintPhone")
        : step === "profile"
          ? t(lang, "createAccountSubtitle")
          : t(lang, "loginSubtitle");

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        {step !== "email" && step !== "profile" ? (
          <button
            type="button"
            onClick={backStep}
            className="btn-icon mb-4 border border-[var(--card-border)] bg-[var(--card)]"
            aria-label={t(lang, "back")}
          >
            <Icon name="arrowLeft" size={20} className="rtl:rotate-180" />
          </button>
        ) : null}
        <div className="text-center">
          <img src="/logo.png" alt="AfghanGPT" className="mx-auto w-[220px] max-w-full dark:hidden" />
          <img src="/logo-dark.png" alt="AfghanGPT" className="mx-auto hidden w-[220px] max-w-full dark:block" />
          <h1 className="mt-4 text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>
        </div>

        <Card className="mt-6 p-5">
          {!isSupabaseConfigured && (
            <p className="mb-4 rounded-2xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
              {t(lang, "setupNeeded")}
            </p>
          )}

          {step === "email" && (
            <form onSubmit={submitEmail} className="flex flex-col gap-4">
              <Field label={t(lang, "email")}>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="name@example.com"
                />
              </Field>
              <Btn type="submit" disabled={busy} className="min-h-12 w-full rounded-full">
                {busy ? t(lang, "loading") : t(lang, "continue")}
              </Btn>
            </form>
          )}

          {step === "checkEmail" && (
            <div className="flex flex-col gap-4">
              <p dir="ltr" className="break-all rounded-2xl bg-[var(--card-border)]/40 px-3 py-2.5 text-center text-sm font-bold">
                {email}
              </p>
              <p className="-mt-1 text-xs leading-relaxed text-[var(--muted)]">{t(lang, "checkSpamHint")}</p>
              <Btn
                type="button"
                disabled={busy || cooldown > 0}
                onClick={() => void resend()}
                className="min-h-12 w-full rounded-full"
              >
                {cooldown > 0
                  ? t(lang, "resendIn").replace("{seconds}", String(cooldown))
                  : t(lang, "resendLink")}
              </Btn>
              <Btn
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setInfo("");
                  setStep("email");
                }}
                className="min-h-12 w-full rounded-full"
              >
                {t(lang, "useDifferentEmail")}
              </Btn>
            </div>
          )}

          {step === "phone" && (
            <form onSubmit={submitPhone} className="flex flex-col gap-4">
              <Field label={t(lang, "countryRegion")}>
                <Select value={dial} onChange={(e) => setDial(e.target.value)}>
                  {COUNTRY_DIALS.map((c) => (
                    <option key={`${c.code}-${c.dial}`} value={c.dial}>
                      {c.name} ({c.dial})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t(lang, "phoneNumber")}>
                <Input
                  type="tel"
                  required
                  inputMode="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel-national"
                  placeholder="789 591 758"
                  dir="ltr"
                  className="text-start"
                />
              </Field>
              <p className="-mt-2 text-xs text-[var(--muted)]">{t(lang, "smsProviderNote")}</p>
              <Btn type="submit" disabled={busy} className="min-h-12 w-full rounded-full">
                {busy ? t(lang, "loading") : t(lang, "continue")}
              </Btn>
            </form>
          )}

          {step === "code" && (
            <form onSubmit={submitCode} className="flex flex-col gap-4">
              <Field label={t(lang, "codeLabel")}>
                <Input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  dir="ltr"
                  className="text-center text-lg tracking-[0.5em]"
                  placeholder="••••••"
                />
              </Field>
              {channel === "phone" && (
                <p className="-mt-2 text-xs text-[var(--muted)]">{t(lang, "codeStepHintPhone")}</p>
              )}
              <Btn type="submit" disabled={busy} className="min-h-12 w-full rounded-full">
                {busy ? t(lang, "loading") : t(lang, "continue")}
              </Btn>
              <Btn
                type="button"
                variant="outline"
                disabled={busy || cooldown > 0}
                onClick={() => void resend()}
                className="min-h-12 w-full rounded-full"
              >
                {cooldown > 0
                  ? t(lang, "resendIn").replace("{seconds}", String(cooldown))
                  : t(lang, "resendCode")}
              </Btn>
            </form>
          )}

          {step === "password" && (
            <form onSubmit={submitPassword} className="flex flex-col gap-4">
              <Field label={t(lang, "email")}>
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
              <Field label={t(lang, "password")}>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              <Btn type="submit" disabled={busy} className="min-h-12 w-full rounded-full">
                {busy ? t(lang, "loading") : t(lang, "login")}
              </Btn>
              <button
                type="button"
                onClick={() => void resetPassword()}
                className="min-h-11 text-sm font-bold text-[var(--brand2)] hover:underline"
              >
                {t(lang, "forgotPassword")}
              </button>
            </form>
          )}

          {step === "profile" && (
            <form onSubmit={submitProfile} className="flex flex-col gap-4">
              <Field label={t(lang, "fullName")}>
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
              </Field>
              <Field label={t(lang, "age")}>
                <Input
                  required
                  inputMode="numeric"
                  value={age}
                  onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  autoComplete="off"
                  dir="ltr"
                />
              </Field>
              <p className="text-xs leading-relaxed text-[var(--muted)]">{t(lang, "profileTerms")}</p>
              <Btn type="submit" disabled={busy} className="min-h-12 w-full rounded-full">
                {busy ? t(lang, "loading") : t(lang, "continue")}
              </Btn>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          )}
          {info && (
            <p role="status" className="mt-4 rounded-2xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {info}
            </p>
          )}

          {step !== "profile" && (
            <>
              <div className="my-5 flex items-center gap-3 text-xs font-bold text-[var(--muted)]">
                <span className="h-px flex-1 bg-[var(--card-border)]" />
                {t(lang, "orDivider")}
                <span className="h-px flex-1 bg-[var(--card-border)]" />
              </div>
              <div className="flex flex-col gap-2.5">
                <Btn
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void google()}
                  className="min-h-12 w-full rounded-full"
                >
                  <GoogleMark /> {t(lang, "continueWithGoogle")}
                </Btn>
                {step === "email" ? (
                  <Btn
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setInfo("");
                      setStep("phone");
                    }}
                    className="min-h-12 w-full rounded-full"
                  >
                    <Icon name="phone" size={20} /> {t(lang, "continueWithPhone")}
                  </Btn>
                ) : null}
                {step === "phone" ? (
                  <Btn
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setInfo("");
                      setStep("email");
                    }}
                    className="min-h-12 w-full rounded-full"
                  >
                    <Icon name="mail" size={20} /> {t(lang, "continueWithEmail")}
                  </Btn>
                ) : null}
                {step === "checkEmail" ? (
                  <Btn
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setInfo("");
                      setPassword("");
                      setStep("password");
                    }}
                    className="min-h-12 w-full rounded-full"
                  >
                    <Icon name="lock" size={20} /> {t(lang, "continueWithPassword")}
                  </Btn>
                ) : null}
                {step === "code" ? (
                  <Btn
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setInfo("");
                      setPassword("");
                      setStep("password");
                    }}
                    className="min-h-12 w-full rounded-full"
                  >
                    <Icon name="lock" size={20} /> {t(lang, "continueWithPassword")}
                  </Btn>
                ) : null}
                {step === "password" ? (
                  <Btn
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setInfo("");
                      setStep(channel === "email" ? "checkEmail" : "code");
                    }}
                    className="min-h-12 w-full rounded-full"
                  >
                    <Icon name="mail" size={20} /> {t(lang, "continueWithEmail")}
                  </Btn>
                ) : null}
              </div>
              {step === "email" && (
                <p className="mt-4 text-center text-xs text-[var(--muted)]">{t(lang, "googlePickerNote")}</p>
              )}
            </>
          )}

          <div className="mt-5 border-t border-[var(--card-border)] pt-4 text-center text-sm">
            <Link href="/" className="min-h-11 text-[var(--muted)] hover:underline">
              <Icon name="arrowLeft" size={16} className="me-1 inline-block align-middle rtl:rotate-180" /> {t(lang, "backToChat")}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
