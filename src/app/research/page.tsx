/**
 * /research — AI research assistant with REAL web search.
 * Uses the free DuckDuckGo Instant Answer API (no key) for facts,
 * then Gemini synthesises a report from the returned sources.
 * AI-generated claims are labelled as such; sources are listed
 * only when the search actually returned them — never invented.
 */
"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { chatText } from "@/lib/client";
import { store } from "@/lib/store";
import Markdown from "@/components/Markdown";
import { Card, Btn, Input, Textarea, Spinner } from "@/components/ui";

type Source = { title: string; url: string; snippet: string };

export default function ResearchPage() {
  const { t } = useLang();
  // Guests work in memory only (logs included); logged-in users keep logs.
  useEffect(() => {
    void store.refreshAuthMode();
  }, []);
  const [query, setQuery] = useState("");
  const [report, setReport] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pastedText, setPastedText] = useState("");

  const searchWeb = async (q: string): Promise<Source[]> => {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`search ${res.status}`);
    const json = (await res.json()) as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: { Text?: string; FirstURL?: string; Name?: string; Topics?: { Text?: string; FirstURL?: string }[] }[];
    };
    const out: Source[] = [];
    if (json.AbstractText && json.AbstractURL) {
      out.push({ title: json.AbstractSource || "DuckDuckGo", url: json.AbstractURL, snippet: json.AbstractText });
    }
    for (const rt of json.RelatedTopics ?? []) {
      if (rt.Text && rt.FirstURL) out.push({ title: rt.Text.slice(0, 80), url: rt.FirstURL, snippet: rt.Text });
      for (const sub of rt.Topics ?? []) {
        if (sub.Text && sub.FirstURL) out.push({ title: sub.Text.slice(0, 80), url: sub.FirstURL, snippet: sub.Text });
      }
      if (out.length >= 8) break;
    }
    return out.slice(0, 8);
  };

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setNotice("");
    setReport("");
    setSources([]);
    try {
      let found: Source[] = [];
      try {
        found = await searchWeb(q);
      } catch (e) {
        store.log("research", e instanceof Error ? e.message : "search failed");
        setNotice("Web search did not return results (network or provider error). The report below is AI-generated only — verify it yourself.");
      }
      setSources(found);
      const sourceBlock = found.length
        ? found.map((s, i) => `[${i + 1}] ${s.title} — ${s.snippet} (${s.url})`).join("\n")
        : "No web sources were returned.";
      const pasted = pastedText.trim() ? `\n\nUser-provided text to analyse:\n${pastedText.slice(0, 12000)}` : "";
      const { text } = await chatText(
        [
          {
            role: "user",
            content: `Research question: "${q}".\n\nWeb search results:\n${sourceBlock}${pasted}\n\nWrite a research report in the user's language with: 1) Short answer, 2) Key points with [n] source numbers for every fact that came from the search results, 3) What is NOT verified / uncertain (label AI-generated claims clearly), 4) Conclusion. Never invent a source or a citation — if a fact has no source above, say so.`,
          },
        ],
        "Act as a careful researcher. Distinguish verified facts from uncertain claims, say when something is not verified, and never invent sources or citations.",
        "smart"
      );
      setReport(text);
    } catch (e) {
      store.log("research", e instanceof Error ? e.message : "research failed");
      setNotice(t("tryAgain"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title={t("research")} subtitle={t("researchSubtitle")} icon="search">
      <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. What is quantum computing?" onKeyDown={(e) => e.key === "Enter" && run()} />
          <Btn onClick={run} disabled={busy || !query.trim()} className="w-full sm:w-auto">
            {busy ? t("loading") : t("research")}
          </Btn>
        </div>
        <Textarea
          className="mt-3"
          rows={3}
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder="Optional: paste text, a document or a URL's content to analyse…"
        />
      </Card>

      {notice && (
        <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">{notice}</p>
      )}
      {busy && (
        <Card className="flex justify-center py-6">
          <Spinner label={t("loading")} />
        </Card>
      )}

      {!busy && !report && sources.length === 0 && !notice && (
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
            <Icon name="search" size={24} />
          </span>
          <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
        </Card>
      )}

      {sources.length > 0 && (
        <Card>
          <h2 className="mb-2 font-bold">{t("researchSources")}</h2>
          <ul className="space-y-2 text-sm">
            {sources.map((s, i) => (
              <li key={i}>
                <a href={s.url} target="_blank" rel="noreferrer" className="font-semibold text-[var(--brand2)] hover:underline">
                  [{i + 1}] {s.title}
                </a>
                <span className="block text-[var(--muted)]">{s.snippet}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {report && (
        <Card>
          <h2 className="mb-2 font-bold">{t("researchReport")}</h2>
          <Markdown text={report} />
          <div className="mt-3 flex gap-2">
            <Btn
              size="sm"
              variant="outline"
              onClick={() => {
                const blob = new Blob([report], { type: "text/markdown;charset=utf-8" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "research-report.md";
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
              }}
            >
              {t("download")} .md
            </Btn>
          </div>
        </Card>
      )}
      </div>
    </AppShell>
  );
}
