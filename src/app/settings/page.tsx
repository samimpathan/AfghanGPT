"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/Providers";
import { t, LANGS, type Lang } from "@/lib/i18n";
import { supabase } from "@/lib/supabaseClient";
import { store, type Settings } from "@/lib/store";
import { providerInfos, type ProviderId } from "@/lib/providers";
import UserAvatar from "@/components/UserAvatar";

/** Optional provider keys (Settings → Providers). Each key is the
 * user's own and stays in this browser only — never sent to our
 * server except inside the provider's own API request. */
const PROVIDER_FIELDS = [
  { id: "openai" as const, label: "OpenAI", field: "openaiKey" as const, placeholder: "sk-…" },
  { id: "anthropic" as const, label: "Anthropic Claude", field: "anthropicKey" as const, placeholder: "sk-ant-…" },
  { id: "deepseek" as const, label: "DeepSeek", field: "deepseekKey" as const, placeholder: "sk-…" },
  { id: "grok" as const, label: "Grok (xAI)", field: "grokKey" as const, placeholder: "xai-…" },
  { id: "qwen" as const, label: "Qwen (Alibaba)", field: "qwenKey" as const, placeholder: "sk-…" },
  { id: "openrouter" as const, label: "OpenRouter", field: "openRouterKey" as const, placeholder: "sk-or-…" },
  { id: "huggingface" as const, label: "Hugging Face", field: "hfKey" as const, placeholder: "hf_…" },
];

export default function SettingsPage() {
  const { lang, setLang, theme, setTheme } = useUi();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [serverGemini, setServerGemini] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, "ok" | "fail" | "testing">>({});
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
    fetch("/api/status")
      .then((r) => r.json() as Promise<{ geminiConfigured?: boolean }>)
      .then((j) => setServerGemini(!!j.geminiConfigured))
      .catch(() => setServerGemini(false));
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

  /** Health test: a tiny real call to the provider ("Say OK").
   * The key travels in the POST body, never in a URL. */
  const testProvider = async (id: ProviderId, key: string) => {
    if (!key.trim()) return;
    setTestResults((prev) => ({ ...prev, [id]: "testing" }));
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, key, test: true }),
      });
      const j = (await res.json()) as { ok?: boolean };
      setTestResults((prev) => ({ ...prev, [id]: j.ok ? "ok" : "fail" }));
    } catch {
      setTestResults((prev) => ({ ...prev, [id]: "fail" }));
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

  function clearHistory() {
    // Guest chats are in-memory only (nothing stored to clear).
    // Logged-in users delete chats from the chat list instead.
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

        {/* Profile: your photo + name. Like Muse, the avatar is your
            photo when set, otherwise your initials on a colour. */}
        {settings && (
          <div className="mt-6 flex items-center gap-4 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <UserAvatar
              name={settings.displayName || email?.split("@")[0] || null}
              email={email}
              photoUrl={settings.avatarDataUrl || null}
              size={64}
            />
            <div className="min-w-0 flex-1">
              <label className="block text-xs font-bold text-slate-500">{t(lang, "yourName")}</label>
              <input
                type="text"
                value={settings.displayName}
                onChange={(e) => updateSettings({ displayName: e.target.value })}
                placeholder={email?.split("@")[0] ?? ""}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
              />
              <div className="mt-2 flex flex-wrap gap-2">
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
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="rounded-xl bg-[#2457FF] px-3 py-2 text-sm font-bold text-white"
                >
                  {t(lang, "uploadPhoto")}
                </button>
                {settings.avatarDataUrl && (
                  <button
                    type="button"
                    onClick={() => updateSettings({ avatarDataUrl: "" })}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold dark:border-slate-700"
                  >
                    {t(lang, "removePhoto")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

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

          {settings && (
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
              <div className="flex items-center justify-between gap-4">
                <span className="font-bold">{t(lang, "provider")}</span>
                <select
                  value={settings.provider}
                  onChange={(e) => updateSettings({ provider: e.target.value as ProviderId })}
                  className="rounded-full border border-slate-300 bg-transparent px-3 py-1.5 dark:border-slate-700"
                >
                  {providerInfos({
                    geminiConfigured: serverGemini,
                    openaiKey: !!settings.openaiKey.trim(),
                    anthropicKey: !!settings.anthropicKey.trim(),
                    deepseekKey: !!settings.deepseekKey.trim(),
                    grokKey: !!settings.grokKey.trim(),
                    qwenKey: !!settings.qwenKey.trim(),
                    openRouterKey: !!settings.openRouterKey.trim(),
                    huggingFaceKey: !!settings.hfKey.trim(),
                  }).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.status === "ready" ? "" : ` — ${t(lang, "providerNeedsKey")}`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-slate-500">
                Gemini: {serverGemini ? t(lang, "configured") : t(lang, "notConfigured")} (server key).
                {` ${t(lang, "providersNote")}`}
              </p>
              {PROVIDER_FIELDS.map((f) => (
                <div key={f.id} className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-500">
                    {f.label} — {t(lang, "providerNeedsKey")}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={settings[f.field]}
                      onChange={(e) => updateSettings({ [f.field]: e.target.value } as Partial<Settings>)}
                      placeholder={f.placeholder}
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
                    />
                    <button
                      type="button"
                      disabled={!settings[f.field].trim() || testResults[f.id] === "testing"}
                      onClick={() => void testProvider(f.id, settings[f.field])}
                      className="shrink-0 rounded-xl bg-[#2457FF] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                    >
                      {testResults[f.id] === "testing"
                        ? t(lang, "loading")
                        : testResults[f.id] === "ok"
                          ? t(lang, "providerTestOk")
                          : testResults[f.id] === "fail"
                            ? t(lang, "providerTestFail")
                            : t(lang, "providerTest")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {settings && (
            <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-800">
              <label className="flex items-center justify-between gap-4">
                <span className="font-bold">{t(lang, "memoryEnabled")}</span>
                <input
                  type="checkbox"
                  checked={settings.memoryEnabled}
                  onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })}
                  className="h-5 w-5 accent-[#2457FF]"
                />
              </label>
              <p className="text-xs text-slate-500">{t(lang, "memoryNote")}</p>
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
                className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
              />
              <button
                type="button"
                onClick={() => {
                  updateSettings({ memoryFacts: [] });
                  setNote(t(lang, "memoryCleared"));
                }}
                className="self-start rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                {t(lang, "memoryClear")}
              </button>
            </div>
          )}

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
