/**
 * /studio/write — Writing Studio.
 * Pick a template, describe the topic, and the AI writes it live
 * via /api/chat (server Gemini key). The result is editable, can be
 * previewed as Markdown, copied, downloaded (.txt / .md / .docx)
 * and saved as a project (kind "doc") in local storage.
 */
"use client";

import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { store, uid } from "@/lib/store";
import { chatText, downloadFileSpec, downloadText } from "@/lib/client";
import type { FileSpec } from "@/lib/filegen";
import Markdown from "@/components/Markdown";
import { Badge, Btn, Card, Field, Select, Spinner, Textarea } from "@/components/ui";

type TemplateId =
  | "article"
  | "blog"
  | "email"
  | "academic"
  | "summary"
  | "rewrite"
  | "grammar"
  | "translation"
  | "social"
  | "seo"
  | "cv"
  | "proposal";

const TEMPLATES: { id: TemplateId; label: string; hint: string; instruction: string }[] = [
  { id: "article", label: "Article", hint: "A well-structured article on the topic.", instruction: "Write a well-structured article with a clear introduction, body sections with subheadings, and a conclusion." },
  { id: "blog", label: "Blog post", hint: "Engaging, readable blog post.", instruction: "Write an engaging blog post that is easy to read, with a catchy opening, short paragraphs and subheadings." },
  { id: "email", label: "Professional email", hint: "A polite, clear work email.", instruction: "Write a polite, clear professional email with a suitable subject line, greeting, body and closing." },
  { id: "academic", label: "Academic help", hint: "Clear academic explanation or essay help.", instruction: "Help with academic writing: explain clearly and formally, with structure, evidence-style reasoning and correct academic tone. Do not invent fake citations or sources." },
  { id: "summary", label: "Summary", hint: "Shorten text to its key points.", instruction: "Summarise the given text faithfully, keeping only the key points. Do not add facts that are not in the text." },
  { id: "rewrite", label: "Rewrite / proofread", hint: "Rewrite the text more clearly.", instruction: "Rewrite and proofread the given text: fix grammar and spelling, improve clarity and flow, and keep the original meaning. Show the improved version." },
  { id: "grammar", label: "Grammar correction", hint: "Fix grammar, keep the meaning.", instruction: "Correct the grammar, spelling and punctuation of the given text, keeping the meaning unchanged. Briefly list the main corrections at the end." },
  { id: "translation", label: "Translation", hint: "Translate into the output language.", instruction: "Translate the given text accurately into the requested output language, keeping the tone and meaning. Do not add extra content." },
  { id: "social", label: "Social media post", hint: "A short, catchy post.", instruction: "Write a short, catchy social media post on the topic, with a hook in the first line and a call to action at the end." },
  { id: "seo", label: "SEO content", hint: "Search-friendly web content.", instruction: "Write search-friendly web content on the topic: use the topic keywords naturally, clear headings, and short readable paragraphs." },
  { id: "cv", label: "CV / Resume", hint: "A professional CV from the details given.", instruction: "Write a professional CV / resume from the details given, with sections for summary, skills, experience and education. Use only the details provided — do not invent jobs, degrees or awards." },
  { id: "proposal", label: "Business proposal", hint: "A formal proposal document.", instruction: "Write a formal business proposal with an introduction, problem, proposed solution, benefits, timeline and closing." },
];

const TONES = ["Formal", "Friendly", "Professional", "Creative"] as const;
const LENGTHS = ["Short", "Medium", "Long"] as const;
const OUT_LANGS = ["Pashto", "English", "Dari", "Arabic"] as const;

const LENGTH_GUIDE: Record<string, string> = {
  Short: "about 100–200 words",
  Medium: "about 300–500 words",
  Long: "about 700–1000 words",
};

function safeName(s: string, fallback: string): string {
  const clean = s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
  return clean || fallback;
}

/** Split plain/markdown text into docx sections by headings and paragraphs. */
function textToDocxSections(text: string): { heading?: string; paragraphs: string[] }[] {
  const sections: { heading?: string; paragraphs: string[] }[] = [{ paragraphs: [] }];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,3}\s+(.*)$/.exec(line)?.[1]?.trim();
    if (heading) {
      sections.push({ heading, paragraphs: [] });
    } else {
      sections[sections.length - 1].paragraphs.push(line);
    }
  }
  const filled = sections.filter((s) => s.heading || s.paragraphs.length > 0);
  return filled.length > 0 ? filled : [{ paragraphs: [text] }];
}

export default function WritingStudioPage() {
  const { t } = useLang();
  // Guests work in memory only; logged-in users may save projects.
  useEffect(() => {
    void store.refreshAuthMode();
  }, []);
  const [template, setTemplate] = useState<TemplateId>("article");
  const [input, setInput] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]>("Professional");
  const [length, setLength] = useState<(typeof LENGTHS)[number]>("Medium");
  const [outLang, setOutLang] = useState<(typeof OUT_LANGS)[number]>("Pashto");
  const [result, setResult] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const active = TEMPLATES.find((tpl) => tpl.id === template) ?? TEMPLATES[0];

  const generate = async () => {
    const topic = input.trim();
    if (!topic) {
      setNotice("Please write a topic or paste your text first.");
      return;
    }
    setLoading(true);
    setNotice("");
    setSaved(false);
    try {
      const prompt =
        `${active.instruction}\n\n` +
        `Tone: ${tone}. Length: ${length} (${LENGTH_GUIDE[length]}). ` +
        `Write the output in ${outLang}.\n\n` +
        `Topic / text:\n${topic}`;
      const { text } = await chatText(
        [{ role: "user", content: prompt }],
        "Act as a professional editor and writer. Write clearly, with good structure, correct grammar, and an engaging tone. Follow the requested tone, length and output language exactly.",
        "smart"
      );
      if (!text.trim()) {
        setNotice("The AI returned an empty answer. Please try again.");
        store.log("studio/write", "empty reply");
      } else {
        setResult(text);
        setShowPreview(false);
        // If the server answered offline/busy (no key), that honest
        // note is the text itself — it is shown as the result, not invented.
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "generate failed";
      store.log("studio/write", msg);
      setNotice(`Could not generate: ${msg}. If the server has no Gemini key, the chat API answers with an offline/busy note instead — nothing was invented.`);
    } finally {
      setLoading(false);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      store.log("studio/write", e instanceof Error ? e.message : "copy failed");
      setNotice("Copy failed — your browser blocked clipboard access. Select the text and copy it manually.");
    }
  };

  const downloadDocx = async () => {
    if (!result.trim()) return;
    try {
      const spec: FileSpec = {
        type: "docx",
        filename: `${safeName(input, "writing")}.docx`,
        docx: { title: safeName(input, active.label), sections: textToDocxSections(result) },
      };
      await downloadFileSpec(spec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "docx download failed";
      store.log("studio/write", msg);
      setNotice(`Could not download .docx: ${msg}`);
    }
  };

  const saveProject = () => {
    if (!result.trim()) return;
    try {
      const name = `${active.label}: ${input.trim().slice(0, 40) || "Untitled"}`;
      const projects = store.projects();
      projects.unshift({
        id: uid(),
        name,
        kind: "doc",
        description: `${active.label} — ${tone}, ${length}, ${outLang}.`,
        files: [{ path: `${safeName(input, "writing")}.md`, content: result }],
        updatedAt: Date.now(),
      });
      store.saveProjects(projects);
      setSaved(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "save failed";
      store.log("studio/write", msg);
      setNotice(`Could not save: ${msg}`);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <header>
        <h1 className="text-2xl font-bold">✎ {t("writing")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Pick a template, describe your topic, and the AI writes it for you — articles, emails, CVs, translations and more.
        </p>
        <p className="mt-2 rounded-xl bg-cyan-500/10 px-3 py-2 text-xs text-cyan-700 dark:text-cyan-300">
          How it works: the text is written live by Gemini through /api/chat using the server key — no key is ever in this page.
          If the server key is not set, the chat API answers with an offline/busy note instead, and that note is shown honestly.
        </p>
      </header>

      <Card>
        <Field label="Template">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => setTemplate(tpl.id)}
                aria-pressed={template === tpl.id}
                className={`rounded-xl border p-3 text-start transition ${
                  template === tpl.id
                    ? "border-violet-500 bg-violet-600/15"
                    : "border-[var(--card-border)] hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <span className="block text-sm font-semibold">{tpl.label}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted)]">{tpl.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-4 space-y-4">
          <Field label={template === "summary" || template === "rewrite" || template === "grammar" || template === "translation" ? "Your text" : "Topic / details"}>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={5}
              placeholder={
                template === "cv"
                  ? "Your name, skills, experience, education…"
                  : template === "translation" || template === "summary" || template === "rewrite" || template === "grammar"
                    ? "Paste your text here…"
                    : "What should this be about? e.g. “Why learning English matters for Afghan students”"
              }
              className="bidi-plaintext"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Tone">
              <Select value={tone} onChange={(e) => setTone(e.target.value as (typeof TONES)[number])}>
                {TONES.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label="Length">
              <Select value={length} onChange={(e) => setLength(e.target.value as (typeof LENGTHS)[number])}>
                {LENGTHS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
            <Field label="Output language">
              <Select value={outLang} onChange={(e) => setOutLang(e.target.value as (typeof OUT_LANGS)[number])}>
                {OUT_LANGS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            </Field>
          </div>

          <Btn onClick={generate} disabled={loading || !input.trim()} className="w-full">
            {loading ? "Writing…" : `✎ ${t("generate")} — ${active.label}`}
          </Btn>
          {loading && <Spinner label="The AI is writing…" />}
        </div>
      </Card>

      {notice && (
        <button type="button" onClick={() => setNotice("")} className="w-full rounded-xl bg-amber-500/15 px-3 py-2 text-start text-sm text-amber-700 dark:text-amber-300">
          {notice} ✕
        </button>
      )}

      {result && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">Result</h2>
            <Badge tone="violet">{active.label}</Badge>
            <Badge tone="cyan">{outLang}</Badge>
            <span className="ms-auto" />
            <Btn size="sm" variant={showPreview ? "primary" : "outline"} onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? t("edit") : t("preview")}
            </Btn>
          </div>

          {showPreview ? (
            <div className="rounded-xl border border-[var(--card-border)] p-3">
              <Markdown text={result} />
            </div>
          ) : (
            <Textarea
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={14}
              aria-label="Generated text — editable"
              className="bidi-plaintext"
            />
          )}
          <p className="mt-1 text-xs text-[var(--muted)]">You can edit the text above before copying, downloading or saving it.</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <Btn size="sm" variant="outline" onClick={copyResult}>{copied ? t("copied") : t("copy")}</Btn>
            <Btn size="sm" variant="outline" onClick={() => downloadText(`${safeName(input, "writing")}.txt`, result, "text/plain")}>
              {t("download")} .txt
            </Btn>
            <Btn size="sm" variant="outline" onClick={() => downloadText(`${safeName(input, "writing")}.md`, result, "text/markdown")}>
              {t("download")} .md
            </Btn>
            <Btn size="sm" variant="outline" onClick={downloadDocx}>{t("download")} .docx</Btn>
            <Btn size="sm" onClick={saveProject}>{saved ? "✓ Saved" : t("save")}</Btn>
          </div>
          {saved && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-300">Saved as a project (kind “doc”) in this device’s local storage.</p>}
        </Card>
      )}
    </div>
  );
}
