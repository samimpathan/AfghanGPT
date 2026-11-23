"use client";

import Image from "next/image";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui";
import { Icon } from "@/components/icons";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { FOUNDER } from "@/lib/founder";

export default function AboutPage() {
  const { lang } = useUi();
  return (
    <AppShell icon="info" title={t(lang, "about")} subtitle={t(lang, "tagline")}>
      <div className="flex flex-col gap-4">
        {/* Founder hero: photo, name, titles, what the app is. */}
        <Card className="p-6 text-center sm:p-8">
          {/* Founder photo in the same zoomed circular frame used
              everywhere else: public/avatar.jpg is a 3:4 full-body
              portrait, so plain object-cover shows the whole body
              and the face is a speck — the frame zooms to the face. */}
          <span className="ai-avatar-frame mx-auto block h-32 w-32 ring-4 ring-[var(--brand2)]/20">
            <Image
              src="/avatar.jpg"
              alt="Abdul Samim Niazai"
              width={128}
              height={128}
              className="ai-avatar-img"
            />
          </span>
          <h2 className="mt-5 text-2xl font-bold">{FOUNDER.fullName}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{FOUNDER.pashtoName}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {FOUNDER.titles.map((title) => (
              <span key={title} className="chip">
                {title}
              </span>
            ))}
          </div>
          <p className="mt-5 text-start leading-7">{t(lang, "aboutText")}</p>
          <p className="mt-4 text-sm font-bold text-[var(--brand2)]">
            {lang === "ps" ? FOUNDER.taglinePs : FOUNDER.taglineEn}
          </p>
        </Card>

        {/* ===== Founder profile (single source: src/lib/founder.ts) ===== */}
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col gap-3 text-sm leading-7">
            <p className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--brand2)]">
                <Icon name="globe" size={18} />
              </span>
              <span className="min-w-0 pt-1">
                <span className="font-bold">{t(lang, "profileLocation")}: </span>
                {FOUNDER.district}, {FOUNDER.province}, {FOUNDER.country}
              </span>
            </p>
            <p className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--brand2)]">
                <Icon name="cap" size={18} />
              </span>
              <span className="min-w-0 pt-1">
                <span className="font-bold">{t(lang, "profileEducation")}: </span>
                {FOUNDER.education.university} — {FOUNDER.education.faculty},{" "}
                {FOUNDER.education.semester}
              </span>
            </p>
          </div>

          <h3 className="mt-6 text-sm font-bold">{t(lang, "profileSkills")}</h3>
          <div className="mt-3 space-y-3">
            {FOUNDER.skills.map((s) => (
              <div key={s.name}>
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>{s.name}</span>
                  <span className="text-[var(--muted)]">{s.level}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-hover)]">
                  <div
                    className="h-full rounded-full bg-[var(--brand2)]"
                    style={{ width: `${s.level}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <h3 className="mt-6 text-sm font-bold">{t(lang, "profilePhilosophy")}</h3>
          <blockquote className="mt-2 rounded-2xl border-s-4 border-[var(--brand2)] bg-[var(--surface)] px-4 py-3 text-sm italic leading-7">
            &ldquo;{FOUNDER.philosophy}&rdquo;
            {lang === "ps" && (
              <>
                <br />
                <span className="not-italic">&ldquo;{FOUNDER.philosophyPs}&rdquo;</span>
              </>
            )}
          </blockquote>
        </Card>

        <div className="text-center">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--brand2)] px-6 font-bold text-white"
          >
            {t(lang, "backToChat")}
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
