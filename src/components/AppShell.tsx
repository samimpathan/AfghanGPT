/**
 * components/AppShell.tsx — the ONE shell for every sub-page
 * (about, settings, admin, studios, research, share). Same
 * persistent sidebar + sticky top bar + centred content column
 * on all pages, so the app reads as one product instead of a
 * dozen one-off layouts. The chat page (/) keeps its own shell
 * (its chat-history sidebar lives in page.tsx); this sidebar is
 * the NAV sidebar for sub-pages, built with the same width
 * (260px, 64px collapsed) and the same visual tokens so the
 * two read as one product.
 *
 * SIDEBAR-LEFT rule (owner, 2026-11-24): the sidebar and the
 * mobile drawer are PHYSICALLY LEFT in every language. The
 * outer row is dir="ltr" so RTL can never flip the sidebar
 * right; the content column re-applies the page direction
 * inside. Physical classes only (left-0, border-r) — never
 * logical start-0 / border-e — for the same reason.
 *
 * Top bar: hamburger (mobile: opens drawer; desktop: collapses
 * the sidebar) | back-to-chat | AfghanGPT wordmark | theme
 * toggle | user avatar (links to Settings). Avatar rules are
 * the same as everywhere else: uploaded photo wins; the founder
 * photo (/avatar.jpg) is the default ONLY for logged-in users
 * with no photo; guests never get it.
 *
 * /login, /register and /live-test do NOT use AppShell, so they
 * are untouched by this shell (no opt-out prop needed).
 */
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/icons";
import { useUi } from "@/components/Providers";
import { useEdgeSwipeDrawer } from "@/lib/useEdgeSwipe";
import { dirOf, t, type Lang } from "@/lib/i18n";
import { store } from "@/lib/store";
import { supabase } from "@/lib/supabaseClient";
import UserAvatar from "@/components/UserAvatar";

type NavItem = { href: string; labelKey: string; icon: IconName };

const NAV_MAIN: NavItem[] = [
  { href: "/", labelKey: "chat", icon: "compose" },
  { href: "/research", labelKey: "research", icon: "search" },
];

const NAV_STUDIOS: NavItem[] = [
  { href: "/studio/write", labelKey: "writing", icon: "pencil" },
  { href: "/studio/code", labelKey: "coding", icon: "code" },
  { href: "/studio/image", labelKey: "image", icon: "image" },
  { href: "/studio/slides", labelKey: "slides", icon: "presentation" },
  { href: "/studio/docs", labelKey: "docs", icon: "fileText" },
  { href: "/studio/builder", labelKey: "builder", icon: "layers" },
  { href: "/studio/workflows", labelKey: "workflows", icon: "workflow" },
];

const NAV_MORE: NavItem[] = [
  { href: "/about", labelKey: "about", icon: "info" },
  // Round 3 item N: Privacy Policy in the sidebar (same nav as About).
  { href: "/privacy", labelKey: "privacyPolicy", icon: "lock" },
  { href: "/settings", labelKey: "settings", icon: "settings" },
  { href: "/admin", labelKey: "admin", icon: "gauge" },
];

function SidebarNav({
  lang,
  pathname,
  collapsed,
  onNavigate,
  onClose,
}: {
  lang: Lang;
  pathname: string | null;
  collapsed: boolean;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const renderGroup = (items: NavItem[]) =>
    items.map((item) => {
      const label = t(lang, item.labelKey);
      const active = pathname === item.href;
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          title={label}
          aria-current={active ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition active:scale-[0.98] ${
            collapsed ? "justify-center px-0" : ""
          } ${
            active
              ? "bg-[#2457FF]/10 font-semibold text-[#2457FF] dark:text-[#7aa5ff]"
              : "text-[var(--muted)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--foreground)]"
          }`}
        >
          <Icon name={item.icon} size={20} className="shrink-0" />
          {collapsed ? null : <span className="min-w-0 truncate">{label}</span>}
        </Link>
      );
    });

  return (
    <>
      <div
        className={`flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3 ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        <Link href="/" onClick={onNavigate} className="flex min-w-0 items-center gap-2" aria-label="AfghanGPT">
          <img src="/logo-mark.png" alt="AfghanGPT" className="h-9 w-9 shrink-0 dark:hidden" />
          <img src="/logo-mark-dark.png" alt="AfghanGPT" className="hidden h-9 w-9 shrink-0 dark:block" />
          {collapsed ? null : <span className="truncate text-lg font-bold tracking-tight">Afghan<span className="text-[#00A060]">GPT</span></span>}
        </Link>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn-icon-sm ml-auto shrink-0"
            aria-label={t(lang, "close")}
          >
            <Icon name="x" size={20} />
          </button>
        ) : null}
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <div className="flex flex-col gap-0.5">{renderGroup(NAV_MAIN)}</div>
        <div className="mx-3 my-2 border-t border-[var(--border-subtle)]" />
        <div className="flex flex-col gap-0.5">{renderGroup(NAV_STUDIOS)}</div>
        <div className="mx-3 my-2 border-t border-[var(--border-subtle)]" />
        <div className="flex flex-col gap-0.5">{renderGroup(NAV_MORE)}</div>
      </nav>
    </>
  );
}

function SidebarFooter({
  lang,
  collapsed,
  email,
  name,
  photo,
  gradient,
  onNavigate,
}: {
  lang: Lang;
  collapsed: boolean;
  email: string | null;
  name: string | null;
  photo: string | null;
  gradient: string;
  onNavigate?: () => void;
}) {
  // Bottom row, mirroring the home drawer (ChatGPT-style): a blue
  // new-chat pill + the user's avatar. On mobile the Chat link
  // navigates home AND closes the drawer (onNavigate); the desktop
  // sidebar stays visible by design.
  if (collapsed) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-[var(--border-subtle)] py-3">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2457FF] text-white transition active:scale-95"
          aria-label={t(lang, "newChat")}
          title={t(lang, "newChat")}
        >
          <Icon name="compose" size={20} />
        </Link>
        <Link href="/settings" onClick={onNavigate} aria-label={t(lang, "settings")} className="shrink-0 rounded-full transition active:scale-90">
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
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-[var(--border-subtle)] p-3">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#2457FF] px-4 text-sm font-bold text-white transition hover:bg-blue-700 active:scale-95"
      >
        <Icon name="compose" size={20} className="shrink-0" /> {t(lang, "chat")}
      </Link>
      <Link href="/settings" onClick={onNavigate} aria-label={t(lang, "settings")} className="shrink-0 rounded-full transition active:scale-90">
        <UserAvatar
          name={name}
          email={email}
          photoUrl={photo}
          fallbackPhoto={email ? "/avatar.jpg" : undefined}
          gradientId={gradient}
          size={40}
        />
      </Link>
    </div>
  );
}

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
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [gradient, setGradient] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Edge swipe (ChatGPT-style): drag right from the left edge to
  // open the drawer, drag left to close it (touch only).
  useEdgeSwipeDrawer(drawerOpen, () => setDrawerOpen(true), () => setDrawerOpen(false));
  const [collapsed, setCollapsed] = useState(false);

  // Navigating closes the mobile drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
        // Same name path as the home header (page.tsx displayNameOf):
        // user_metadata.full_name first, then the email prefix.
        // Settings displayName (set above) still wins when present.
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
        const fullName =
          typeof meta.full_name === "string" && meta.full_name.trim()
            ? meta.full_name.trim()
            : null;
        if (!store.settings().displayName) setName(fullName ?? u.email?.split("@")[0] ?? null);
      }
    });
  }, []);

  return (
    <div dir="ltr" className="flex min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      {/* ===== Persistent desktop sidebar (md+, 260px / 64px collapsed) =====
          Physically LEFT: this row is dir="ltr", so the aside (first
          flex child) stays left in RTL and LTR alike. */}
      <aside
        className={`hidden shrink-0 flex-col overflow-hidden border-r border-[var(--border-subtle)] bg-[var(--sidebar)] transition-[width] duration-150 md:flex ${
          collapsed ? "w-16" : "w-[260px]"
        }`}
      >
        <SidebarNav lang={lang} pathname={pathname} collapsed={collapsed} />
        <SidebarFooter
          lang={lang}
          collapsed={collapsed}
          email={email}
          name={name}
          photo={photo}
          gradient={gradient}
        />
      </aside>

      {/* ===== Mobile drawer (overlay, <md only), from the LEFT ===== */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label={t(lang, "close")}
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/35"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-[var(--border-subtle)] bg-[var(--sidebar)] shadow-md">
            <SidebarNav
              lang={lang}
              pathname={pathname}
              collapsed={false}
              onNavigate={() => setDrawerOpen(false)}
              onClose={() => setDrawerOpen(false)}
            />
            <SidebarFooter
              lang={lang}
              collapsed={false}
              email={email}
              name={name}
              photo={photo}
              gradient={gradient}
              onNavigate={() => setDrawerOpen(false)}
            />
          </aside>
        </div>
      )}

      <div dir={dirOf(lang)} className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--background)]/95 backdrop-blur">
          {/* dir="ltr" like the home header: hamburger physically left,
              avatar physically right, in both languages. */}
          <div dir="ltr" className="flex h-14 w-full items-center gap-1 px-3 sm:px-5">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="btn-icon relative border border-[var(--card-border)] bg-[var(--card)] md:hidden"
              aria-label="Menu"
            >
              <Icon name="menu" size={24} />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="btn-icon relative hidden border border-[var(--card-border)] bg-[var(--card)] md:flex"
              aria-label={collapsed ? t(lang, "expand") : t(lang, "collapse")}
            >
              <Icon name="menu" size={24} />
            </button>
            <Link href="/" className="btn-icon-sm" aria-label={t(lang, "backToChat")}>
              <Icon
                name="arrowLeft"
                size={20}
                className={dirOf(lang) === "rtl" ? "rotate-180" : ""}
              />
            </Link>
            <Link href="/" className="flex min-w-0 items-center gap-2 px-1">
              <img src="/logo-mark.png" alt="AfghanGPT" className="h-8 w-8 shrink-0 dark:hidden" />
              <img src="/logo-mark-dark.png" alt="AfghanGPT" className="hidden h-8 w-8 shrink-0 dark:block" />
              <span className="truncate text-base font-bold">Afghan<span className="text-[#00A060]">GPT</span></span>
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
            {/* Logged out: a "Log in" pill instead of the guest
                avatar. Logged in: the user's avatar, as before. */}
            {email ? (
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
            ) : (
              <Link
                href="/login"
                className="flex h-9 shrink-0 items-center rounded-full bg-black px-4 text-sm font-bold text-white transition hover:opacity-85 active:scale-95 dark:bg-white dark:text-black"
              >
                {t(lang, "login")}
              </Link>
            )}
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
    </div>
  );
}
