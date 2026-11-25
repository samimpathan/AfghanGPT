/**
 * app/auth/callback/page.tsx — Google OAuth (and email-link) return.
 *
 * The browser client uses supabase-js's DEFAULT flow (implicit:
 * `flowType` is not set in lib/supabaseClient, and the installed
 * @supabase/auth-js defaults flowType to 'implicit' with
 * detectSessionInUrl: true). So there is NO `code` for this page
 * to exchange via exchangeCodeForSession — Supabase returns the
 * session in the URL fragment (#access_token=...), the SDK
 * detects it automatically when the client initialises, saves
 * the session and fires SIGNED_IN. This page therefore only
 * waits for the session to appear (onAuthStateChange + a
 * getSession() poll as fallback) and then routes by profile
 * completeness:
 *   - full name + age already in user_metadata → home (/)
 *   - otherwise → /login?step=profile (the profile step)
 * If no session appears within ~10 s (e.g. the provider is not
 * configured, or the link expired), an honest error + a link back
 * to /login is shown. If Supabase returns an OAuth failure TO
 * this page (?error=... / #error=...), that error is shown at
 * once instead of waiting out the timeout (R3-I). No session,
 * token, or code is ever logged.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, Spinner } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackPage() {
  const { lang } = useUi();
  const router = useRouter();
  // Error KEY, not a translated string: the effect below runs once
  // on mount, when `lang` is still the default (ps) — the saved
  // language is applied by Providers only afterwards. Translating
  // at render time keeps the error in the user's own language.
  const [errorKey, setErrorKey] = useState("");

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setErrorKey("setupNeeded");
      return;
    }
    // R3-I: Supabase returns OAuth failures TO this page as
    // ?error=... / ?error_description=... (PKCE-style) or
    // #error=... / #error_description=... (implicit-style).
    // Show them at once instead of waiting out the 10 s
    // timeout below. (The raw-400 "provider is not enabled"
    // page never returns here — the /api/auth/providers
    // pre-flight in AuthWizard is what catches that case.)
    // Error VALUES are never logged; only which friendly key
    // was shown matters.
    const query = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const errDesc = query.get("error_description") ?? hash.get("error_description") ?? "";
    const errCode = query.get("error") ?? hash.get("error") ?? "";
    if (errCode || errDesc) {
      setErrorKey(
        /provider is not enabled/i.test(errDesc) ? "googleNotConfigured" : "googleSignInFailed"
      );
      return;
    }
    let done = false;
    const finish = (meta: Record<string, unknown>) => {
      if (done) return;
      done = true;
      const name = meta.full_name;
      const age = meta.age;
      const complete =
        typeof name === "string" &&
        name.trim().length > 0 &&
        typeof age === "number" &&
        age >= 1 &&
        age <= 120;
      router.replace(complete ? "/" : "/login?step=profile");
    };
    const { data: listener } = client.auth.onAuthStateChange((_e, session) => {
      if (session?.user) finish((session.user.user_metadata ?? {}) as Record<string, unknown>);
    });
    // The SDK auto-exchanges the code on load; poll as a fallback
    // in case the event fires before this page mounts.
    const poll = setInterval(() => {
      client.auth.getSession().then(({ data }) => {
        if (data.session?.user)
          finish((data.session.user.user_metadata ?? {}) as Record<string, unknown>);
      });
    }, 500);
    const timeout = setTimeout(() => {
      if (!done) {
        done = true;
        setErrorKey("googleSignInFailed");
      }
    }, 10000);
    return () => {
      listener.subscription.unsubscribe();
      clearInterval(poll);
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#2457FF] text-white shadow-sm">
          <Icon name="sparkles" size={28} />
        </span>
        <h1 className="mt-4 text-2xl font-bold">{t(lang, "appShort")}</h1>
        <Card className="mt-6 p-5">
          {errorKey ? (
            <>
              <p role="alert" className="rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
                {t(lang, errorKey)}
              </p>
              <Link href="/login" className="mt-4 inline-block min-h-11 font-bold text-[var(--brand2)] hover:underline">
                {t(lang, "loginOrSignup")}
              </Link>
            </>
          ) : (
            <div className="flex justify-center py-2">
              <Spinner label={t(lang, "loading")} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
