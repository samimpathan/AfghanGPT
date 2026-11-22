"use client";

import Image from "next/image";
import Link from "next/link";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";

export default function AboutPage() {
  const { lang } = useUi();
  return (
    <div className="min-h-dvh bg-white px-4 py-10 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-2xl text-center">
        <Image
          src="/avatar.jpg"
          alt="Abdul Samim Niazai"
          width={120}
          height={120}
          className="mx-auto rounded-full object-cover"
        />
        <h1 className="mt-4 text-2xl font-bold">{t(lang, "appName")}</h1>
        <p className="mt-1 text-sm text-slate-500">Samim AI — {t(lang, "tagline")}</p>
        <p className="mt-6 text-start leading-7">{t(lang, "aboutText")}</p>
        <p className="mt-4 text-start leading-7">{t(lang, "founder")}</p>
        <p className="mt-6 rounded-2xl bg-slate-100 px-4 py-3 text-sm font-bold dark:bg-slate-800">
          {t(lang, "notMuse")}
        </p>
        <Link
          href="/"
          className="mt-8 inline-block rounded-xl bg-[#2457FF] px-6 py-3 font-bold text-white"
        >
          ← {t(lang, "backToChat")}
        </Link>
      </div>
    </div>
  );
}
