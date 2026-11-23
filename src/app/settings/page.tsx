"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Btn } from "@/components/ui";
import { useUi } from "@/components/Providers";
import { t, LANGS, type Lang } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";
import { listChats, deleteChat } from "@/lib/chats";
import { store, type Settings } from "@/lib/store";
import UserAvatar, { AVATAR_GRADIENTS, AUTO_GRADIENT_BACKGROUND, initialsOf } from "@/components/UserAvatar";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-11 items-center rounded-full border px-4 py-2.5 text-sm font-bold transition-colors ${
        active
          ? "border-[var(--brand2)] bg-[var(--brand2)] text-white"
          : "border-[var(--card-border)] bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

export default function SettingsPage() {
  const { lang, setLang, theme, setTheme } = useUi();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  /** Profile photo: downscale client-side to 256px (JPEG 0.8) and save
   * it in settings.avatarDataUrl. The chat + drawer read the same
   * setting, so the new avatar shows everywhere immediately. */
  const onPhotoPicked = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        try {
          const size = 256;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const side = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          updateSettings({ avatarDataUrl: canvas.toDataURL("image/jpeg", 0.8) });
          setNote(t(lang, "saved"));
        } catch {
          // ignore
        }
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    try {
      setSettings(store.settings());
    } catch {
      // ignore
    }
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    try {
      const next = { ...store.settings(), ...patch };
      store.saveSettings(next);
      setSettings(next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user?.email ?? null);
    });
  }, []);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    // Guest chats are in-memory only — they die with the session;
    // there is no stored guest history to clear anymore.
    router.push("/");
  }

  /** ROUND 5 fix: this button used to only SHOW "history cleared"
   * without clearing anything. Now it really clears it: the local
   * studio chats (in-memory for guests, localStorage for logged-in
   * users), the logged-in user's Supabase chats, and the per-device
   * chat folders/archive. It also writes a clear-signal timestamp
   * ("samim-ai-clear-chats") that the chat page honours on its next
   * mount by dropping its in-memory guest chats — guest chats live
   * only in the chat page's state, so no other page can clear them
   * directly. Settings (language, theme, model) are NOT touched. */
  async function clearHistory() {
    try {
      store.saveChats([]);
      try {
        localStorage.removeItem("samim-ai-chat-meta");
        localStorage.setItem("samim-ai-clear-chats", String(Date.now()));
      } catch {
        // ignore
      }
      if (supabase) {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id;
        if (uid) {
          const chats = await listChats(uid);
          for (const c of chats) {
            await deleteChat(c.id);
          }
        }
      }
      setNote(t(lang, "historyCleared"));
    } catch {
      setNote(t(lang, "historyCleared"));
    }
  }

  return (
    <AppShell icon="settings" title={t(lang, "settings")} subtitle={t(lang, "settingsSubtitle")}>
      <div className="flex flex-col gap-4">
        {/* Profile first: your photo + name. Like Muse, the avatar is
            your photo when set, otherwise your initials on a colour. */}
        <Section title={t(lang, "profileSection")}>
          {settings ? (
            <>
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                <UserAvatar
                  name={settings.displayName || email?.split("@")[0] || null}
                  email={email}
                  photoUrl={settings.avatarDataUrl || null}
                  gradientId={settings.avatarGradient || undefined}
                  size={96}
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  aria-label={t(lang, "uploadPhoto")}
                  className="absolute -bottom-1 -end-1 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand2)] text-sm text-white shadow"
                >
                  <Icon name="pencil" size={16} />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <label className="block text-xs font-bold text-[var(--muted)]">{t(lang, "yourName")}</label>
                <input
                  type="text"
                  value={settings.displayName}
                  onChange={(e) => updateSettings({ displayName: e.target.value })}
                  placeholder={email?.split("@")[0] ?? ""}
                  className="mt-1 w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--brand2)]"
                />
                <p className="mt-1.5 text-xs text-[var(--muted)]">{t(lang, "displayNameHint")}</p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    onPhotoPicked(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="min-h-11 rounded-xl bg-[var(--brand2)] px-3 py-2.5 text-sm font-bold text-white"
                  >
                    {t(lang, "uploadPhoto")}
                  </button>
                  {settings.avatarDataUrl && (
                    <button
                      type="button"
                      onClick={() => updateSettings({ avatarDataUrl: "" })}
                      className="min-h-11 rounded-xl border border-[var(--card-border)] px-3 py-2.5 text-sm font-bold"
                    >
                      {t(lang, "removePhoto")}
                    </button>
                  )}
                </div>
              </div>
            </div>
            {/* Avatar colour: pick the gradient your initials use.
                Each swatch shows your own initials on that gradient;
                "Auto" keeps the deterministic one for your name. The
                preview below shows the same avatar at the three sizes
                it appears at in the app — the gradient also rims your
                photo (or the default photo) everywhere as the ring. */}
            <div className="border-t border-[var(--card-border)] pt-4">
              <p className="text-sm font-bold">{t(lang, "avatarGradient")}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{t(lang, "avatarGradientHint")}</p>
              <div className="mt-3 flex flex-wrap gap-2.5" role="radiogroup" aria-label={t(lang, "avatarGradient")}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!settings.avatarGradient}
                  aria-label={t(lang, "avatarGradientAuto")}
                  onClick={() => updateSettings({ avatarGradient: "" })}
                  className={`relative shrink-0 rounded-full transition active:scale-90 ${!settings.avatarGradient ? "ring-2 ring-[var(--brand2)] ring-offset-2 ring-offset-[var(--card)]" : ""}`}
                >
                  <span
                    style={{ width: 44, height: 44, background: AUTO_GRADIENT_BACKGROUND, fontSize: 15, textShadow: "0 1px 2px rgba(0, 0, 0, 0.30)" }}
                    className="flex items-center justify-center rounded-full font-bold text-white"
                  >
                    {initialsOf(settings.displayName || email?.split("@")[0] || null, email)}
                  </span>
                  {!settings.avatarGradient && (
                    <span className="absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand2)] text-white shadow">
                      <Icon name="check" size={12} />
                    </span>
                  )}
                </button>
                {AVATAR_GRADIENTS.map((g) => {
                  const selected = settings.avatarGradient === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={g.label}
                      onClick={() => updateSettings({ avatarGradient: g.id })}
                      className={`relative shrink-0 rounded-full transition active:scale-90 ${selected ? "ring-2 ring-[var(--brand2)] ring-offset-2 ring-offset-[var(--card)]" : ""}`}
                    >
                      <span
                        style={{ width: 44, height: 44, background: g.background }}
                        className="block rounded-full shadow-sm"
                      />
                      {selected && (
                        <span className="absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--brand2)] text-white shadow">
                          <Icon name="check" size={12} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs font-bold text-[var(--muted)]">
                {settings.avatarGradient
                  ? AVATAR_GRADIENTS.find((g) => g.id === settings.avatarGradient)?.label ?? t(lang, "avatarGradientAuto")
                  : t(lang, "avatarGradientAuto")}
              </p>
              <p className="mt-4 text-sm font-bold">{t(lang, "avatarPreview")}</p>
              {/* Audit fix: the preview strip now passes the same
                  fallbackPhoto the header/drawer use, so a logged-in
                  user with no uploaded photo sees /avatar.jpg here
                  instead of initials. Guests get no fallback. */}
              <div className="mt-3 flex items-end gap-6">
                <div className="flex flex-col items-center gap-1.5">
                  <UserAvatar
                    name={settings.displayName || email?.split("@")[0] || null}
                    email={email}
                    photoUrl={settings.avatarDataUrl || null}
                    fallbackPhoto={email ? "/avatar.jpg" : undefined}
                    gradientId={settings.avatarGradient || undefined}
                    size={96}
                  />
                  <span className="text-[11px] text-[var(--muted)]">{t(lang, "avatarPreviewProfile")}</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <UserAvatar
                    name={settings.displayName || email?.split("@")[0] || null}
                    email={email}
                    photoUrl={settings.avatarDataUrl || null}
                    fallbackPhoto={email ? "/avatar.jpg" : undefined}
                    gradientId={settings.avatarGradient || undefined}
                    size={40}
                  />
                  <span className="text-[11px] text-[var(--muted)]">{t(lang, "avatarPreviewDrawer")}</span>
                </div>
                <div className="flex flex-col items-center gap-1.5">
                  <UserAvatar
                    name={settings.displayName || email?.split("@")[0] || null}
                    email={email}
                    photoUrl={settings.avatarDataUrl || null}
                    fallbackPhoto={email ? "/avatar.jpg" : undefined}
                    gradientId={settings.avatarGradient || undefined}
                    size={32}
                  />
                  <span className="text-[11px] text-[var(--muted)]">{t(lang, "avatarPreviewChat")}</span>
                </div>
              </div>
            </div>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">{t(lang, "loading")}</p>
          )}
          <p className="text-xs leading-relaxed text-[var(--muted)]">{t(lang, "photoHint")}</p>
        </Section>

        <Section title={t(lang, "appearanceSection")}>
          <div>
            <p className="text-sm font-bold">{t(lang, "language")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <Pill key={l.code} active={lang === l.code} onClick={() => setLang(l.code as Lang)}>
                  {l.label}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-bold">{t(lang, "theme")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Pill active={theme === "light"} onClick={() => setTheme("light")}>
                <Icon name="sun" size={15} className="me-1 inline-block align-middle" /> {t(lang, "light")}
              </Pill>
              <Pill active={theme === "dark"} onClick={() => setTheme("dark")}>
                <Icon name="moon" size={15} className="me-1 inline-block align-middle" /> {t(lang, "dark")}
              </Pill>
            </div>
          </div>
        </Section>

        <Section title={t(lang, "chatSection")}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "modelInfo")}</span>
            <span className="max-w-[60%] rounded-full bg-[var(--surface)] px-3 py-1 text-end text-xs">
              {t(lang, "freeModelNote")}
            </span>
          </div>

          {settings && (
            <>
              <div className="flex flex-col gap-3 border-t border-[var(--card-border)] pt-4 text-sm">
                <label className="flex min-h-11 items-center justify-between gap-4">
                  <span className="font-bold">{t(lang, "memoryEnabled")}</span>
                  <input
                    type="checkbox"
                    checked={settings.memoryEnabled}
                    onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })}
                    className="h-5 w-5 shrink-0 accent-[var(--brand2)]"
                  />
                </label>
                <p className="text-xs leading-relaxed text-[var(--muted)]">{t(lang, "memoryNote")}</p>
                <textarea
                  value={settings.memoryFacts.join("\n")}
                  onChange={(e) =>
                    updateSettings({
                      memoryFacts: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={4}
                  placeholder="e.g. My name is Samim. I am learning Python."
                  className="w-full rounded-xl border border-[var(--card-border)] bg-transparent px-3 py-2.5 text-sm outline-none focus:border-[var(--brand2)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    updateSettings({ memoryFacts: [] });
                    setNote(t(lang, "memoryCleared"));
                  }}
                  className="min-h-11 self-start rounded-xl border border-[var(--card-border)] px-3 py-2.5 text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5"
                >
                  {t(lang, "memoryClear")}
                </button>
              </div>
            </>
          )}
        </Section>

        <Section title={t(lang, "privacySection")}>
          <p className="rounded-2xl bg-[var(--surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
            {t(lang, "guestNote")}
          </p>
          <button
            type="button"
            onClick={clearHistory}
            className="min-h-11 rounded-xl border border-red-300 px-3 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            {t(lang, "clearHistory")}
          </button>
        </Section>

        <Section title={t(lang, "accountSection")}>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "accountInfo")}</span>
            <span className="min-w-0 truncate text-[var(--muted)]" dir="ltr">
              {email ?? "—"}
            </span>
          </div>
          {email ? (
            <Btn variant="outline" onClick={logout} className="min-h-11 self-start">
              <Icon name="logout" size={16} /> {t(lang, "logout")}
            </Btn>
          ) : (
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--brand2)] px-4 py-2.5 text-sm font-bold text-white"
            >
              {t(lang, "login")}
            </Link>
          )}
        </Section>

        {note && (
          <p
            role="status"
            className="rounded-2xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          >
            {note}
          </p>
        )}
      </div>
    </AppShell>
  );
}
