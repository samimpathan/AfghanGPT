"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { useUi } from "@/components/Providers";
import { t, LANGS, type Lang } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";
import { listChats, deleteChat } from "@/lib/chats";
import { store, type Settings } from "@/lib/store";
import { CURATED_VOICES, defaultVoiceForLang } from "@/lib/voices";
import { playGeminiSpeech, detectTextLang, type GeminiAudio } from "@/lib/voice";
import UserAvatar, { AVATAR_GRADIENTS, AUTO_GRADIENT_BACKGROUND, initialsOf } from "@/components/UserAvatar";


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

type Group = {
  id: string;
  icon: IconName;
  title: string;
  summary?: string;
  /** Multilingual search haystack (ps/en/fa/ar terms) so the filter
   * works no matter which language the UI is in. */
  keys: string;
  content: React.ReactNode;
};

export default function SettingsPage() {
  const { lang, setLang, theme, setTheme } = useUi();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [previewVoice, setPreviewVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<GeminiAudio | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  /** Play the sample sentence in one voice (Settings Preview).
   * Tapping the playing voice again stops it. A null result
   * (no key / TTS unavailable) shows an honest note instead of
   * pretending the preview played. */
  const previewVoiceSample = async (voiceId: string) => {
    if (previewVoice === voiceId) {
      previewAudioRef.current?.stop();
      previewAudioRef.current = null;
      setPreviewVoice(null);
      return;
    }
    previewAudioRef.current?.stop();
    previewAudioRef.current = null;
    setPreviewVoice(voiceId);
    const sample = t(lang, "voicePreviewText");
    let played: GeminiAudio | null = null;
    try {
      played = await playGeminiSpeech(sample, detectTextLang(sample), () => {
        previewAudioRef.current = null;
        setPreviewVoice(null);
      }, voiceId);
    } catch {
      played = null;
    }
    if (!played) {
      setPreviewVoice(null);
      setNote(t(lang, "voicePreviewFailed"));
    } else {
      previewAudioRef.current = played;
    }
  };

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

  const langLabel = LANGS.find((l) => l.code === lang)?.label ?? lang;
  const themeLabel = theme === "light" ? t(lang, "light") : t(lang, "dark");
  const displayName = settings?.displayName || email?.split("@")[0] || "";

  /* Every pre-R3 setting, mapped into a ChatGPT-style row. Each row
   * expands in place to reveal its real controls — nothing is a dead
   * link and no ChatGPT row was invented without a real equivalent
   * (see report: Notifications, Voice, Safety & wellbeing, Codex,
   * Storage and Ads controls have no AfghanGPT setting and are
   * omitted, not faked). */
  const groups: Group[] = [
    {
      id: "profile",
      icon: "user",
      title: t(lang, "profileSection"),
      summary: displayName || undefined,
      keys: "profile photo avatar name display name colour gradient پروفایل عکس نوم اوتار رنګ پروفایل عکس نام آواتار رنگ الملف الصورة الاسم لون التدرج",
      content: settings ? (
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
          <p className="text-xs leading-relaxed text-[var(--muted)]">{t(lang, "photoHint")}</p>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t(lang, "loading")}</p>
      ),
    },
    {
      id: "general",
      icon: "settings",
      title: t(lang, "general"),
      summary: `${langLabel} · ${themeLabel}`,
      keys: "general language theme light dark appearance عمومي ژبه رنګ روښانه تور عمومی زبان رنگ روشن تیره عام اللغة المظهر فاتح داكن",
      content: (
        <>
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
        </>
      ),
    },
    {
      id: "voice",
      icon: "speaker",
      title: t(lang, "voiceSection"),
      summary: settings?.voice ? settings.voice : t(lang, "voiceAuto"),
      keys: "voice sound speaker read aloud preview غږ آواز غږیز اورېدل صدا صوت استماع معاينة",
      content: settings ? (
        <>
          <p className="text-xs leading-relaxed text-[var(--muted)]">{t(lang, "voiceSectionHint")}</p>
          {/* Voice picker: free Gemini prebuilt voices only — no
              voice here needs payment or an account, and there is
              no cloning. "Automatic" keeps the per-language
              default (Kore for Pashto/Dari, Puck for English).
              Each row previews the voice with a real sample
              sentence through /api/speech. */}
          <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label={t(lang, "voiceSection")}>
            <div
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                !settings.voice ? "border-[var(--brand2)] bg-[var(--brand2)]/5" : "border-[var(--card-border)]"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={!settings.voice}
                onClick={() => updateSettings({ voice: "" })}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-sm font-bold">
                  A
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{t(lang, "voiceAuto")}</span>
                  <span className="block truncate text-xs text-[var(--muted)]">{defaultVoiceForLang(lang)}</span>
                </span>
                {!settings.voice && <Icon name="check" size={14} className="shrink-0 text-[var(--brand2)]" />}
              </button>
            </div>
            {CURATED_VOICES.map((v) => {
              const selected = settings.voice === v.id;
              const playing = previewVoice === v.id;
              return (
                <div
                  key={v.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 ${
                    selected ? "border-[var(--brand2)] bg-[var(--brand2)]/5" : "border-[var(--card-border)]"
                  }`}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => updateSettings({ voice: v.id })}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-sm font-bold">
                      {v.id[0]}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{v.id}</span>
                      <span className="block truncate text-xs text-[var(--muted)]">{t(lang, v.descKey)}</span>
                    </span>
                    {selected && <Icon name="check" size={14} className="shrink-0 text-[var(--brand2)]" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => void previewVoiceSample(v.id)}
                    className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs font-bold"
                  >
                    <Icon name={playing ? "volumeOff" : "play"} size={13} />
                    {playing ? t(lang, "voicePlaying") : t(lang, "voicePreview")}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{t(lang, "voiceAutoHint")}</p>
        </>
      ) : (
        <p className="text-sm text-[var(--muted)]">{t(lang, "loading")}</p>
      ),
    },
    {
      id: "usage",
      icon: "gauge",
      title: t(lang, "usageLimits"),
      summary: t(lang, "modelAuto"),
      keys: "usage limits model free auto کارول محدودیتونه ماډل وړیا مصرف محدودیت مدل رایگان الاستخدام الحدود النموذج مجاني",
      content: (
        <div className="flex items-center justify-between gap-4 text-sm">
          <span className="font-bold">{t(lang, "modelInfo")}</span>
          <span className="max-w-[60%] rounded-full bg-[var(--surface)] px-3 py-1 text-end text-xs">
            {t(lang, "freeModelNote")}
          </span>
        </div>
      ),
    },
    {
      id: "memory",
      icon: "sparkles",
      title: t(lang, "memory"),
      summary: settings?.memoryEnabled ? t(lang, "memoryEnabled") : undefined,
      keys: "memory facts remember یاد حقایق حافظه حقائق الذاكرة حقائق تذكر",
      content: settings ? (
        <div className="flex flex-col gap-3 text-sm">
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
      ) : (
        <p className="text-sm text-[var(--muted)]">{t(lang, "loading")}</p>
      ),
    },
    {
      id: "privacy",
      icon: "lock",
      title: t(lang, "privacyCenter"),
      keys: "privacy center guest محرمیت مرکز حریم خصوصی مرکز الخصوصية ضيف مهمان",
      content: (
        <p className="rounded-2xl bg-[var(--surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--muted)]">
          {t(lang, "guestNote")}
        </p>
      ),
    },
    {
      id: "history",
      icon: "archive",
      title: t(lang, "historyData"),
      keys: "history data clear delete chats تاریخچه معلومات پاک تاریخچه داده پاک السجل البيانات مسح حذف",
      content: (
        <button
          type="button"
          onClick={clearHistory}
          className="min-h-11 rounded-xl border border-red-300 px-3 py-2.5 text-sm font-bold text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
        >
          {t(lang, "clearHistory")}
        </button>
      ),
    },
    {
      id: "security",
      icon: "mail",
      title: t(lang, "securityLogin"),
      summary: email ?? undefined,
      keys: "security login account email logout sign in امنیت ننوتل اکاونټ ایمیل امنیت ورود حساب ایمیل الأمان تسجيل الدخول الحساب البريد الإلكتروني",
      content: (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold">{t(lang, "accountInfo")}</span>
            <span className="min-w-0 truncate text-[var(--muted)]" dir="ltr">
              {email ?? "—"}
            </span>
          </div>
          {!email && (
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--brand2)] px-4 py-2.5 text-sm font-bold text-white"
            >
              {t(lang, "login")}
            </Link>
          )}
        </div>
      ),
    },
  ];

  const searching = query.trim().length > 0;
  const visibleGroups = useMemo(() => {
    if (!searching) return groups;
    const words = query.trim().toLowerCase().split(/\s+/);
    return groups.filter((g) => {
      const hay = `${g.title} ${g.summary ?? ""} ${g.keys}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    // NOTE: previewVoice MUST be listed here. The Voice group's
    // content reads it (the Preview button's playing state), and
    // without it this memo returns the stale group content built
    // when previewVoice was null — the button never shows
    // "playing" and stop-on-retap never fires (found by the
    // Playwright verification, 2026-11-25).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searching, query, lang, settings, email, theme, previewVoice]);

  return (
    <AppShell icon="settings" title={t(lang, "settings")} subtitle={t(lang, "settingsSubtitle")}>
      <div className="flex flex-col gap-4">
        {/* Search settings: filters the rows below as you type; while
            searching, every matching group is shown expanded. */}
        <label className="flex min-h-12 items-center gap-2.5 rounded-full border border-[var(--card-border)] bg-[var(--card)] px-4 shadow-sm">
          <Icon name="search" size={19} className="shrink-0 text-[var(--muted)]" />
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(lang, "searchSettings")}
            aria-label={t(lang, "searchSettings")}
            className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-[var(--muted)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t(lang, "close")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-black/5 dark:hover:bg-white/10"
            >
              <Icon name="x" size={16} />
            </button>
          )}
        </label>

        {/* One grouped card, ChatGPT-style: icon + label + chevron rows. */}
        <div className="overflow-hidden rounded-3xl border border-[var(--card-border)] bg-[var(--card)] shadow-sm">
          {visibleGroups.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">{t(lang, "noSettingsFound")}</p>
          ) : (
            visibleGroups.map((g) => {
              const open = searching || openId === g.id;
              return (
                <div key={g.id} className="border-b border-[var(--card-border)] last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(openId === g.id ? null : g.id)}
                    aria-expanded={open}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    <Icon name={g.icon} size={22} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{g.title}</span>
                    {g.summary && (
                      <span className="hidden min-w-0 max-w-[45%] truncate text-xs text-[var(--muted)] sm:block">
                        {g.summary}
                      </span>
                    )}
                    <Icon
                      name="chevronDown"
                      size={18}
                      className={`shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
                    />
                  </button>
                  {open && (
                    <div className="border-t border-[var(--card-border)] px-4 py-4">
                      <div className="flex flex-col gap-4">{g.content}</div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Log out: its own row below the card, like ChatGPT. Guests
            get a Log in row instead (same /login destination as before). */}
        {email ? (
          <button
            type="button"
            onClick={logout}
            className="flex min-h-14 w-full items-center gap-3 rounded-3xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3.5 text-start text-red-600 shadow-sm transition-colors hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            <Icon name="logout" size={22} className="shrink-0" />
            <span className="flex-1 text-[15px] font-medium">{t(lang, "logout")}</span>
          </button>
        ) : (
          <Link
            href="/login"
            className="flex min-h-14 w-full items-center gap-3 rounded-3xl bg-[var(--brand2)] px-4 py-3.5 text-start text-white shadow-sm"
          >
            <Icon name="logout" size={22} className="shrink-0 -scale-x-100" />
            <span className="flex-1 text-[15px] font-medium">{t(lang, "login")}</span>
          </Link>
        )}

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
