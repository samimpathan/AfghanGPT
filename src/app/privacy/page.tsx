"use client";

import Link from "next/link";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/ui";
import { useUi } from "@/components/Providers";
import { t } from "@/lib/i18n";
import { PRIVACY_TEXT, type PrivacyLang } from "@/lib/privacyText";

/**
 * app/privacy/page.tsx — the Privacy Policy page (Round 3 item N).
 * The text lives in src/lib/privacyText.ts (ps / fa / en, audited
 * from the code — no invented facts). The page follows the current
 * UI language; Arabic UI shows the English version (no Arabic
 * policy text exists).
 */
export default function PrivacyPage() {
  const { lang } = useUi();
  // Arabic UI falls back to English — stated in the round report.
  const policyLang: PrivacyLang = lang === "ps" || lang === "fa" ? lang : "en";
  const text = PRIVACY_TEXT[policyLang];
  return (
    <AppShell icon="lock" title={text.title} subtitle={text.updated}>
      <div className="flex flex-col gap-4">
        <Card className="p-6 sm:p-8">
          <p className="text-sm leading-7">{text.intro}</p>
        </Card>
        {text.sections.map((section) => (
          <Card key={section.heading} className="p-6 sm:p-8">
            <h2 className="text-base font-bold">{section.heading}</h2>
            <div className="mt-3 flex flex-col gap-3">
              {section.paragraphs.map((p) => (
                <p key={p.slice(0, 24)} className="text-sm leading-7 text-[var(--foreground)]">
                  {p}
                </p>
              ))}
            </div>
          </Card>
        ))}
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
