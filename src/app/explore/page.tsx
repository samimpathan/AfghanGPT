/**
 * /explore — the Explore page (owner, 2026-11-25): the 8 studios as
 * large tappable cards. The sidebar Explore button opens this page
 * (it used to only scroll the drawer to the studio list); the list
 * no longer lives in the drawer. Visibility follows the same
 * store.settings().features flags the drawer used.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { store } from "@/lib/store";
import { STUDIOS } from "@/lib/studios";
import { Card } from "@/components/ui";

export default function ExplorePage() {
  const { t } = useLang();
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  useEffect(() => {
    void store.refreshAuthMode();
    try {
      setFeatures(store.settings().features ?? {});
    } catch {
      // storage unavailable — all studios stay visible
    }
  }, []);
  const visible = STUDIOS.filter((s) => features[s.feature] !== false);

  return (
    <AppShell title={t("explore")} subtitle={t("exploreSubtitle")} icon="compass">
      {visible.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="flex items-start gap-3 rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-4 shadow-sm transition hover:bg-[var(--surface-hover)] active:scale-[0.98]"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2457FF]/10 text-[#2457FF]">
                <Icon name={s.icon} size={24} />
              </span>
              <span className="min-w-0">
                <span className="block text-base font-bold">{t(s.key)}</span>
                <span className="mt-0.5 block text-sm leading-snug text-[var(--muted)]">
                  {t(s.subtitle)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
