/**
 * components/AppShell.tsx — the ONE shell for every sub-page
 * (about, settings, admin, studios, research, share, login,
 * register). Same sticky top bar + centred content column on all
 * pages, so the app reads as one product instead of a dozen
 * one-off layouts. The chat page (/) keeps its own shell.
 *
 * Top bar: back-to-chat | AfghanGPT wordmark | theme toggle |
 * user avatar (links to Settings). Avatar rules are the same as
 * everywhere else: uploaded photo wins; the founder photo
 * (/avatar.jpg) is the default ONLY for logged-in users with no
 * photo; guests never get it.
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { store } from "@/lib/store";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar from "@/components/UserAvatar";

export default function AppShell({
  title,
  subtitle,
  icon,
  children,
  wide = false,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  children: ReactNode;
  wide?: boolean;
  actions?: ReactNode;
}) {
  const { lang, theme, setTheme } = useUi();
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [gradient, setGradient] = useState("");

  useEffect(() => {
    try {
      const s = store.settings();
      setPhoto(s.avatarDataUrl || null);
      setGradient(s.avatarGradient || "");
      if (s.displayName) setName(s.displayName);
    } catch {
      // ignore
    }
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      if (u) {
        setEmail(u.email ?? null);
        if (!store.settings().displayName) setName(u.email?.split("@")[0] ?? null);
      }
    });
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--background)]/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-3 sm:px-5">
          <Link href="/" className="btn-icon-sm" aria-label={t(lang, "backToChat")}>
            <Icon name="arrowLeft" size={20} className="rtl:rotate-180" />
          </Link>
          <Link href="/" className="flex min-w-0 items-center gap-2 px-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#2457FF] text-white">
              <Icon name="sparkles" size={18} />
            </span>
            <span className="truncate text-base font-bold">AfghanGPT</span>
          </Link>
          <span className="min-w-0 flex-1" />
          {actions}
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="btn-icon"
            aria-label={theme === "dark" ? t(lang, "light") : t(lang, "dark")}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
          </button>
          <Link href="/settings" aria-label={t(lang, "settings")} className="shrink-0 rounded-full transition active:scale-90">
            <UserAvatar
              name={name}
              email={email}
              photoUrl={photo}
              fallbackPhoto={email ? "/avatar.jpg" : undefined}
              gradientId={gradient}
              size={32}
            />
          </Link>
        </div>
      </header>
      <main className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-3xl"} flex-1 px-4 py-6 sm:px-6`}>
        <div className="mb-6 flex items-start gap-3">
          {icon ? (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2457FF]/10 text-[#2457FF] dark:text-[#7aa5ff]">
              <Icon name={icon} size={24} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{subtitle}</p> : null}
          </div>
        </div>
        {children}
        <p className="mt-10 text-center text-xs text-[var(--muted)]">{t(lang, "notMuse")}</p>
      </main>
    </div>
  );
}
