"use client";

import Image from "next/image";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { FOUNDER } from "@/lib/founder";

export default function AboutPage() {
  const { lang } = useUi();
  return (
    <div className="min-h-dvh px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm font-bold text-[var(--brand2)] hover:underline">
          <Icon name="arrowLeft" size={16} className="me-1 inline-block align-middle rtl:rotate-180" /> {t(lang, "backToChat")}
        </Link>

        <div className="mt-6 rounded-3xl border border-[var(--card-border)] bg-[var(--card)] p-6 text-center shadow-sm sm:p-8">
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
          <h1 className="mt-5 text-2xl font-bold text-[var(--brand2)]">
            {t(lang, "appShort")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">{t(lang, "appName")} — {t(lang, "tagline")}</p>

          <div className="mt-6 flex flex-col gap-4 text-start">
            <p className="leading-7">{t(lang, "aboutText")}</p>
            <p className="rounded-2xl bg-black/5 px-4 py-3 text-center text-sm font-bold dark:bg-white/5">
              {t(lang, "notMuse")}
            </p>
          </div>

          {/* ===== Founder profile (single source: src/lib/founder.ts) ===== */}
          <div className="mt-8 rounded-3xl border border-[var(--card-border)] bg-black/[0.03] p-5 text-start dark:bg-white/[0.03] sm:p-6">
            <h2 className="text-center text-xl font-bold">
              {FOUNDER.fullName}
            </h2>
            <p className="mt-1 text-center text-sm text-[var(--muted)]">
              {FOUNDER.pashtoName}
            </p>
            <p className="mt-2 text-center text-sm font-bold text-[var(--brand2)]">
              {FOUNDER.titles.join(" • ")}
            </p>

            <div className="mt-5 space-y-2 text-sm leading-7">
              <p>
                <span className="font-bold">{t(lang, "profileLocation")}: </span>
                {FOUNDER.district}, {FOUNDER.province}, {FOUNDER.country}
              </p>
              <p>
                <span className="font-bold">{t(lang, "profileEducation")}: </span>
                {FOUNDER.education.university} — {FOUNDER.education.faculty},{" "}
                {FOUNDER.education.semester}
              </p>
            </div>

            <h3 className="mt-5 text-sm font-bold">{t(lang, "profileSkills")}</h3>
            <div className="mt-2 space-y-2">
              {FOUNDER.skills.map((s) => (
                <div key={s.name}>
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>{s.name}</span>
                    <span className="text-[var(--muted)]">{s.level}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--brand2)]"
                      style={{ width: `${s.level}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <h3 className="mt-5 text-sm font-bold">{t(lang, "profilePhilosophy")}</h3>
            <blockquote className="mt-2 rounded-2xl border-s-4 border-[var(--brand2)] bg-black/[0.03] px-4 py-3 text-sm italic leading-7 dark:bg-white/[0.03]">
              &ldquo;{FOUNDER.philosophy}&rdquo;
              {lang === "ps" && (
                <>
                  <br />
                  <span className="not-italic">&ldquo;{FOUNDER.philosophyPs}&rdquo;</span>
                </>
              )}
            </blockquote>

            <p className="mt-5 text-center text-sm font-bold text-[var(--brand2)]">
              {lang === "ps" ? FOUNDER.taglinePs : FOUNDER.taglineEn}
            </p>
          </div>

          <Link
            href="/"
            className="mt-8 inline-block rounded-xl bg-[var(--brand2)] px-6 py-3 font-bold text-white"
          >
            {t(lang, "backToChat")}
          </Link>
        </div>
      </div>
    </div>
  );
}
