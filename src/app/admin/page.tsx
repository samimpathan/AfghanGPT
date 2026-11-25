"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { Badge, Card, Stat } from "@/components/ui";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { isAdminEmail, ADMIN_EMAIL } from "@/lib/admin";
import { listChats, listMessages } from "@/lib/chats";
import { store } from "@/lib/store";
import { providerInfos } from "@/lib/providers";
import { FOUNDER } from "@/lib/founder";

type Status = {
  supabaseConfigured: boolean;
  geminiConfigured: boolean;
  geminiModel: string;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="text-sm font-bold">{title}</h2>
      <div className="mt-3">{children}</div>
    </Card>
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
            <Icon name="arrowLeft" size={16} className="me-1 inline-block align-middle rtl:rotate-180" /> {t(lang, "backToChat")}
          </Link>
        </div>
      </div>
    );
  }

  const supabaseOk = status ? status.supabaseConfigured : isSupabaseConfigured;
  const geminiOnline = status ? status.geminiConfigured : false;
  const geminiModel = status?.geminiModel ?? "gemini-3-flash-preview";

  return (
    <AppShell
      icon="gauge"
      title={t(lang, "adminDashboard")}
      subtitle={`${name || FOUNDER.pashtoName} • ${email}`}
      wide
      actions={<Badge tone="amber">{t(lang, "admin")}</Badge>}
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat value={totalChats == null ? "—" : String(totalChats)} label={t(lang, "totalChats")} />
          <Stat value={totalMessages == null ? "—" : String(totalMessages)} label={t(lang, "totalMessages")} />
        </div>

        <Section title={t(lang, "appStatus")}>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex min-h-11 items-center justify-between gap-4">
              <span className="font-bold">Supabase</span>
              <Badge tone={supabaseOk ? "green" : "amber"}>
                {supabaseOk ? t(lang, "connected") : t(lang, "notConfigured")}
              </Badge>
            </div>
            <div className="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--card-border)] pt-3">
              <span className="min-w-0 font-bold">
                AI model • <span className="break-all font-normal text-[var(--muted)]">{geminiModel}</span>
              </span>
              <Badge tone={geminiOnline ? "green" : "amber"}>
                {geminiOnline ? t(lang, "online") : t(lang, "offline")}
              </Badge>
            </div>
          </div>
        </Section>

        <Section title={t(lang, "accountInfo")}>
          <p className="text-xs leading-relaxed text-[var(--muted)]">{t(lang, "adminNote")}</p>
        </Section>

        <Section title={t(lang, "studioCounts")}>
          <div className="grid grid-cols-2 gap-3">
            <Stat value={String(studioCounts.chats)} label={t(lang, "totalChats")} />
            <Stat value={String(studioCounts.projects)} label={t(lang, "totalProjects")} />
            <Stat value={String(studioCounts.images)} label={t(lang, "totalImages")} />
            <Stat value={String(studioCounts.workflows)} label={t(lang, "totalWorkflows")} />
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {t(lang, "studioFeatures")} • {studioCounts.runs} {t(lang, "adminRuns")}
          </p>
        </Section>

        <Section title={t(lang, "providers")}>
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
              <div key={p.id} className="flex min-h-11 items-center justify-between gap-4">
                <span className="min-w-0">
                  <span className="font-bold">{p.name}</span>
                  <span className="block break-words text-xs text-[var(--muted)]">{p.models.join(", ")}</span>
                </span>
                <Badge tone={p.status === "ready" ? "green" : "amber"}>
                  {p.status === "ready" ? t(lang, "configured") : t(lang, "notConfigured")}
                </Badge>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">{t(lang, "limitsNote")}</p>
        </Section>

        <Section title={t(lang, "studioFeatures")}>
          {Object.keys(features).length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t(lang, "empty")}</p>
          ) : (
            <div className="flex flex-col gap-2 text-sm">
              {Object.keys(features).map((f) => (
                <label key={f} className="flex min-h-11 items-center justify-between gap-4">
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
        </Section>

        <Section title={t(lang, "errorLog")}>
          {logs.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">{t(lang, "empty")}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {logs.slice(0, 30).map((l, i) => (
                <li key={i} className="rounded-xl bg-[var(--surface)] px-2.5 py-2">
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(l.ts).toLocaleString()} — {l.where}
                  </span>
                  <span className="block break-words">{l.message}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={t(lang, "users")}>
          <p className="text-sm leading-relaxed text-[var(--muted)]">{t(lang, "usersNote")}</p>
        </Section>

        <div className="flex flex-col gap-2">
          <a
            href="https://supabase.com/dashboard/project/kmofyrkgwpgqztcggtaq/sql/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--brand2)] px-3 py-2.5 text-sm font-bold text-white"
          >
            {t(lang, "openSupabase")} <Icon name="external" size={14} className="ms-1 inline-block align-middle" />
          </a>
          <a
            href="https://vercel.com/samimpatan8-8864/afghan-gpt/settings/environment-variables"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5 text-sm font-bold"
          >
            {t(lang, "openVercel")} <Icon name="external" size={14} className="ms-1 inline-block align-middle" />
          </a>
          <a
            href="https://github.com/samimpathan/AfghanGPT"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-3 py-2.5 text-sm font-bold"
          >
            {t(lang, "openGithub")} <Icon name="external" size={14} className="ms-1 inline-block align-middle" />
          </a>
        </div>

        <p className="text-xs text-[var(--muted)]">
          {t(lang, "admin")} • <span dir="ltr">{ADMIN_EMAIL}</span> • AfghanGPT
        </p>
      </div>
    </AppShell>
  );
}
