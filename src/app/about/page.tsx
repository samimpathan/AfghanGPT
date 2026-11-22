"use client";

import Image from "next/image";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";

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
            {t(lang, "appName")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Samim AI — {t(lang, "tagline")}</p>

          <div className="mt-6 flex flex-col gap-4 text-start">
            <p className="leading-7">{t(lang, "aboutText")}</p>
            <p className="leading-7">{t(lang, "founder")}</p>
            <p className="rounded-2xl bg-black/5 px-4 py-3 text-center text-sm font-bold dark:bg-white/5">
              {t(lang, "notMuse")}
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
