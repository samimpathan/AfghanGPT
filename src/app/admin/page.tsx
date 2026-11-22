"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { isAdminEmail, ADMIN_EMAIL } from "@/lib/admin";
import { listChats, listMessages } from "@/lib/chats";
import { store } from "@/lib/store";
import { providerInfos } from "@/lib/providers";

type Status = {
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
  geminiModel: string;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-2xl bg-black/5 px-3 py-4 text-center dark:bg-white/5">
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{label}</p>
    </div>
  );
}

export default function AdminPage() {
  const { lang } = useUi();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [totalChats, setTotalChats] = useState<number | null>(null);
  const [totalMessages, setTotalMessages] = useState<number | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  // Merged studios (local, this device only).
  const [studioCounts, setStudioCounts] = useState({ chats: 0, projects: 0, images: 0, workflows: 0, runs: 0 });
  const [logs, setLogs] = useState<{ ts: number; where: string; message: string }[]>([]);
  const [features, setFeatures] = useState<Record<string, boolean>>({});

  useEffect(() => {
    // Guests read from memory only; logged-in admins see saved counts.
    store.refreshAuthMode().then(() => {
      try {
        const s = store.settings();
        setFeatures(s.features ?? {});
        setStudioCounts({
          chats: store.chats().length,
          projects: store.projects().length,
          images: store.images().length,
          workflows: store.workflows().length,
          runs: store.runs().length,
        });
        setLogs(store.logs());
      } catch {
        // ignore — admin still shows the server status above
      }
    });
  }, []);

  const toggleFeature = (key: string) => {
    try {
      const s = store.settings();
      const next = { ...(s.features ?? {}), [key]: (s.features?.[key] ?? true) === false };
      store.saveSettings({ ...s, features: next });
      setFeatures(next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user ?? null;
      if (!user) {
        router.replace("/login");
        return;
      }
      setEmail(user.email ?? null);
      setName(
        (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          ""
      );
      if (isAdminEmail(user.email)) {
        const rows = await listChats(user.id);
        setTotalChats(rows.length);
        let count = 0;
        for (const row of rows) {
          const msgs = await listMessages(row.id);
          count += msgs.length;
        }
        setTotalMessages(count);
      }
      setChecking(false);
    });
  }, [router]);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => r.json() as Promise<Status>)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (checking) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <p className="text-sm text-[var(--muted)]">{t(lang, "loading")}</p>
      </div>
    );
  }

  // Not logged in: the effect above already redirects to /login.
  // If Supabase is not configured there is no session to check.
  if (!email) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-6 text-center shadow-sm">
          <p className="text-sm text-[var(--muted)]">{t(lang, "login")}</p>
          <Link href="/login" className="mt-4 inline-block font-bold text-[var(--brand2)] hover:underline">
            {t(lang, "login")}
          </Link>
        </div>
      </div>
    );
  }

  if (!isAdminEmail(email)) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <div className="rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-6 text-center shadow-sm">
          <p className="text-lg font-bold">{t(lang, "adminOnly")}</p>
          <Link href="/" className="mt-4 inline-block font-bold text-[var(--brand2)] hover:underline">
            <span className="inline-block rtl:rotate-180">←</span> {t(lang, "backToChat")}
          </Link>
        </div>
      </div>
    );
  }

  const supabaseOk = status ? status.supabaseConfigured : isSupabaseConfigured;
  const geminiOnline = status ? status.geminiConfigured : false;
  const geminiModel = status?.geminiModel ?? "gemini-3-flash-preview";

  return (
    <div className="min-h-dvh px-4 py-6">
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <Link href="/" className="self-start text-sm font-bold text-[var(--brand2)] hover:underline">
          <span className="inline-block rtl:rotate-180">←</span> {t(lang, "backToChat")}
        </Link>

        <header className="flex items-center gap-3">
          <Image
            src="/avatar.jpg"
            alt="Samim AI"
            width={56}
            height={56}
            className="rounded-full object-cover ring-2 ring-amber-400/50"
          />
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold">
              {t(lang, "adminDashboard")}
              <span className="rounded-full bg-amber-400 px-2.5 py-0.5 text-xs font-bold text-black">
                {t(lang, "admin")}
              </span>
            </h1>
            <p className="truncate text-sm text-[var(--muted)]">
              {name || "عبدالصمیم نیازی"} • <span dir="ltr">{email}</span>
            </p>
          </div>
        </header>

        <Card title={t(lang, "appStatus")}>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="font-bold">Supabase</span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  supabaseOk ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-black/5 dark:bg-white/10"
                }`}
              >
                {supabaseOk ? t(lang, "connected") : t(lang, "notConfigured")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="min-w-0 font-bold">
                Gemini • <span className="break-all font-normal text-[var(--muted)]">{geminiModel}</span>
              </span>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                  geminiOnline ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-black/5 dark:bg-white/10"
                }`}
              >
                {geminiOnline ? t(lang, "online") : t(lang, "offline")}
              </span>
            </div>
          </div>
        </Card>

        <Card title={t(lang, "accountInfo")}>
          <div className="grid grid-cols-2 gap-2">
            <Stat value={totalChats ?? "—"} label={t(lang, "totalChats")} />
            <Stat value={totalMessages ?? "—"} label={t(lang, "totalMessages")} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{t(lang, "adminNote")}</p>
        </Card>

        <Card title={t(lang, "studioCounts")}>
          <div className="grid grid-cols-2 gap-2">
            <Stat value={studioCounts.chats} label={t(lang, "totalChats")} />
            <Stat value={studioCounts.projects} label={t(lang, "totalProjects")} />
            <Stat value={studioCounts.images} label={t(lang, "totalImages")} />
            <Stat value={studioCounts.workflows} label={t(lang, "totalWorkflows")} />
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {t(lang, "studioFeatures")} • {studioCounts.runs} {t(lang, "adminRuns")}
          </p>
        </Card>

        <Card title={t(lang, "providers")}>
          <div className="flex flex-col gap-3 text-sm">
            {providerInfos({
              geminiConfigured: geminiOnline,
              openaiKey: !!store.settings().openaiKey.trim(),
              anthropicKey: !!store.settings().anthropicKey.trim(),
              deepseekKey: !!store.settings().deepseekKey.trim(),
              grokKey: !!store.settings().grokKey.trim(),
              qwenKey: !!store.settings().qwenKey.trim(),
              openRouterKey: !!store.settings().openRouterKey.trim(),
              huggingFaceKey: !!store.settings().hfKey.trim(),
            }).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-4">
                <span className="min-w-0">
                  <span className="font-bold">{p.name}</span>
                  <span className="block break-words text-xs text-[var(--muted)]">{p.models.join(", ")}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                    p.status === "ready" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-black/5 dark:bg-white/10"
                  }`}
                >
                  {p.status === "ready" ? t(lang, "configured") : t(lang, "providerNeedsKey")}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{t(lang, "limitsNote")}</p>
        </Card>

        <Card title={t(lang, "studioFeatures")}>
          {Object.keys(features).length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t(lang, "empty")}</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              {Object.keys(features).map((f) => (
                <label key={f} className="flex items-center justify-between gap-4">
                  <span className="capitalize">{f}</span>
                  <input
                    type="checkbox"
                    checked={features[f] !== false}
                    onChange={() => toggleFeature(f)}
                    className="h-5 w-5 shrink-0 accent-[var(--brand2)]"
                  />
                </label>
              ))}
            </div>
          )}
        </Card>

        <Card title={t(lang, "errorLog")}>
          {logs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t(lang, "empty")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {logs.slice(0, 30).map((l, i) => (
                <li key={i} className="rounded-xl bg-black/5 px-2.5 py-2 dark:bg-white/5">
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(l.ts).toLocaleString()} — {l.where}
                  </span>
                  <span className="block break-words">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t(lang, "users")}>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t(lang, "usersNote")}</p>
        </Card>

        <div className="flex flex-col gap-2">
          <a
            href="https://supabase.com/dashboard/project/kmofyrkgwpgqztcggtaq/sql/new"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-[var(--brand2)] px-3 py-2.5 text-center text-sm font-bold text-white"
          >
            {t(lang, "openSupabase")} ↗
          </a>
          <a
            href="https://vercel.com/samimpatan8-8864/samim-ai/settings/environment-variables"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5 text-center text-sm font-bold"
          >
            {t(lang, "openVercel")} ↗
          </a>
          <a
            href="https://github.com/samimpathan/SamimAI"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5 text-center text-sm font-bold"
          >
            {t(lang, "openGithub")} ↗
          </a>
        </div>

        <p className="text-xs text-[var(--muted)]">
          {t(lang, "admin")} • <span dir="ltr">{ADMIN_EMAIL}</span> • Samim AI
        </p>
      </div>
    </div>
  );
}
