/**
 * /studio/slides — Presentation Maker (Gamma-style): AI outline via
 * chatJson with a strict schema, fully editable slides, themed live
 * preview, real PPTX/PDF export via /api/files, deck saved in
 * localStorage under "samim-slides" for logged-in users only —
 * guests work in memory and the deck dies with the session.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { chatJson, downloadFileSpec } from "@/lib/client";
import { store } from "@/lib/store";
import { Btn, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

const STORAGE_KEY = "samim-slides";

type DeckSlide = { title: string; bullets: string[]; notes: string };
type Deck = { title: string; slides: DeckSlide[] };

type Theme = {
  name: string;
  bg: string;
  card: string;
  accent: string;
  text: string;
  sub: string;
};

const THEMES: Record<string, Theme> = {
  Midnight: { name: "Midnight", bg: "#0B1226", card: "#111B30", accent: "#2457FF", text: "#EAF2FF", sub: "#AAB7D0" },
  Royal: { name: "Royal", bg: "#2A1650", card: "#3B1F6E", accent: "#A855F7", text: "#F5F0FF", sub: "#D6C2FF" },
  Ocean: { name: "Ocean", bg: "#062A3A", card: "#0A3D52", accent: "#00D4FF", text: "#EAFBFF", sub: "#A8D8E8" },
};

const EMPTY_DECK: Deck = {
  title: "",
  slides: [{ title: "Title slide", bullets: ["Add your points here"], notes: "" }],
};

function isDeck(v: unknown): v is Deck {
  if (!v || typeof v !== "object") return false;
  const d = v as { title?: unknown; slides?: unknown };
  if (typeof d.title !== "string" || !Array.isArray(d.slides) || d.slides.length === 0) return false;
  return d.slides.every(
    (s) =>
      s && typeof s === "object" &&
      typeof (s as DeckSlide).title === "string" &&
      Array.isArray((s as DeckSlide).bullets) &&
      (s as DeckSlide).bullets.every((b) => typeof b === "string")
  );
}

function normaliseDeck(v: unknown): Deck {
  const d = v as Deck;
  return {
    title: d.title.trim(),
    slides: d.slides.map((s) => ({
      title: s.title.trim() || "Untitled slide",
      bullets: s.bullets.map((b) => b.trim()).filter(Boolean),
      notes: typeof s.notes === "string" ? s.notes : "",
    })),
  };
}

function slug(s: string): string {
  const clean = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return clean || "presentation";
}

export default function SlidesPage() {
  const { t } = useLang();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [audience, setAudience] = useState("General");
  const [language, setLanguage] = useState("English");
  const [themeName, setThemeName] = useState("Midnight");
  const [deck, setDeck] = useState<Deck>(EMPTY_DECK);
  const [current, setCurrent] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<"pptx" | "pdf" | null>(null);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const loadedRef = useRef(false);

  const theme = THEMES[themeName] ?? THEMES.Midnight;

  // Load the saved deck once — LOGGED-IN ONLY. Guests start with a
  // fresh deck in memory; nothing is read from or written to storage.
  useEffect(() => {
    store.refreshAuthMode().then(() => {
      if (store.isMemoryOnly()) return;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (isDeck(parsed)) {
            setDeck(normaliseDeck(parsed));
            return;
          }
        }
      } catch {
        /* corrupt save — start fresh */
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on every change (after the initial load) — logged-in only.
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      return;
    }
    if (store.isMemoryOnly()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      /* storage full/unavailable — the deck still works in memory */
    }
  }, [deck]);

  async function handleGenerate(): Promise<void> {
    if (!topic.trim()) {
      setError("Please enter a topic first.");
      return;
    }
    const n = Math.min(15, Math.max(3, count || 5));
    setError("");
    setGenerating(true);
    try {
      const system =
        "You are a presentation outline writer. Reply with ONLY a strict JSON object, no markdown fences, no extra text. " +
        'Schema: {"title":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]}. ' +
        "Every slide needs a short title and 2-5 short bullets. Notes are one sentence of speaker notes.";
      const deckOut = await chatJson<Deck>(
        [
          {
            role: "user",
            content:
              `Create a presentation outline about: ${topic.trim()}\n` +
              `Number of slides: ${n}\nAudience / purpose: ${audience}\nLanguage: ${language}\n` +
              "Write all titles, bullets and notes in the requested language.",
          },
        ],
        system,
        "smart"
      );
      if (!isDeck(deckOut)) throw new Error("bad-json");
      setDeck(normaliseDeck(deckOut));
      setCurrent(0);
    } catch (e) {
      const msg =
        e instanceof Error && e.message === "bad-json"
          ? "The AI returned an outline that could not be read (bad JSON). Nothing was changed — please try generating again."
          : e instanceof Error
            ? `Could not generate the outline: ${e.message}. Nothing was changed — please try again.`
            : "Could not generate the outline. Nothing was changed — please try again.";
      setError(msg);
      store.log("studio/slides", msg);
    } finally {
      setGenerating(false);
    }
  }

  function updateSlide(i: number, patch: Partial<DeckSlide>): void {
    setDeck((d) => ({ ...d, slides: d.slides.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }));
  }

  function moveSlide(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= deck.slides.length) return;
    setDeck((d) => {
      const slides = [...d.slides];
      [slides[i], slides[j]] = [slides[j], slides[i]];
      return { ...d, slides };
    });
    setCurrent(j);
  }

  function addSlide(): void {
    setDeck((d) => ({ ...d, slides: [...d.slides, { title: "New slide", bullets: [""], notes: "" }] }));
    setCurrent(deck.slides.length);
  }

  function deleteSlide(i: number): void {
    if (deck.slides.length <= 1) {
      setError("A deck needs at least one slide.");
      return;
    }
    setDeck((d) => ({ ...d, slides: d.slides.filter((_, idx) => idx !== i) }));
    setCurrent((c) => Math.max(0, Math.min(c, deck.slides.length - 2)));
  }

  async function handleExport(kind: "pptx" | "pdf"): Promise<void> {
    if (deck.slides.length === 0) {
      setError("Add at least one slide before exporting.");
      return;
    }
    setError("");
    setExporting(kind);
    try {
      const filename = slug(deck.title || topic || "presentation");
      if (kind === "pptx") {
        await downloadFileSpec({
          type: "pptx",
          filename: `${filename}.pptx`,
          pptx: {
            title: deck.title || topic || "Presentation",
            slides: deck.slides.map((s) => ({ title: s.title, bullets: s.bullets, notes: s.notes || undefined })),
            theme: { bg: theme.bg, accent: theme.accent, text: theme.text },
          },
        });
      } else {
        const lines: string[] = [];
        deck.slides.forEach((s, i) => {
          lines.push(`Slide ${i + 1}: ${s.title}`);
          s.bullets.forEach((b) => lines.push(`• ${b}`));
          if (s.notes.trim()) lines.push(`Notes: ${s.notes}`);
          lines.push("");
        });
        await downloadFileSpec({
          type: "pdf",
          filename: `${filename}.pdf`,
          pdf: { title: deck.title || topic || "Presentation", lines },
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? `Export failed: ${e.message}. Your deck is still saved.` : "Export failed. Your deck is still saved.";
      setError(msg);
      store.log("studio/slides", msg);
    } finally {
      setExporting(null);
    }
  }

  const slide = deck.slides[Math.min(current, deck.slides.length - 1)];

  return (
    <AppShell title={t("slides")} subtitle={t("slidesSubtitle")} icon="presentation">
      <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <Field label="Topic">
            <Input dir="auto" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. How photosynthesis works" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Number of slides (3–15)">
              <Input
                type="number"
                min={3}
                max={15}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </Field>
            <Field label="Audience / purpose">
              <Select value={audience} onChange={(e) => setAudience(e.target.value)}>
                <option>Education</option>
                <option>Business</option>
                <option>General</option>
              </Select>
            </Field>
            <Field label="Language">
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option>Pashto</option>
                <option>English</option>
                <option>Dari</option>
                <option>Arabic</option>
              </Select>
            </Field>
            <Field label="Theme">
              <Select value={themeName} onChange={(e) => setThemeName(e.target.value)}>
                {Object.keys(THEMES).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Btn onClick={handleGenerate} disabled={generating || !topic.trim()} className="w-full">
            {generating ? "Generating outline…" : "Generate outline"}
          </Btn>
          {generating && <Spinner label="Asking the AI for an outline…" />}
          {error && (
            <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
          {savedAt && <p className="text-xs text-[var(--muted)]">Deck auto-saved on this device{savedAt ? ` · ${savedAt}` : ""}.</p>}
        </div>
      </Card>

      <Card>
        <Field label="Presentation title">
          <Input dir="auto" value={deck.title} onChange={(e) => setDeck((d) => ({ ...d, title: e.target.value }))} placeholder="Presentation title" />
        </Field>
      </Card>

      {/* Live preview */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("preview")}</h2>
          <span className="text-xs text-[var(--muted)]">
            Slide {current + 1} of {deck.slides.length}
          </span>
        </div>
        {slide && (
          <div
            className="aspect-video w-full overflow-hidden rounded-xl p-5 sm:p-8"
            style={{ background: theme.bg, color: theme.text }}
            dir="auto"
          >
            <div className="h-1.5 w-16 rounded-full" style={{ background: theme.accent }} />
            <h3 className="mt-4 text-lg font-bold leading-snug sm:text-2xl">{slide.title}</h3>
            <ul className="mt-3 space-y-1.5 text-sm sm:text-base" style={{ color: theme.sub }}>
              {slide.bullets.filter(Boolean).map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span style={{ color: theme.accent }}>•</span>
                  <span>{b}</span>
                </li>
              ))}
              {slide.bullets.filter(Boolean).length === 0 && (
                <li className="opacity-60">No bullets yet — add some below.</li>
              )}
            </ul>
            {slide.notes.trim() && (
              <p className="mt-4 text-xs italic opacity-70">Notes: {slide.notes}</p>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Btn variant="outline" size="sm" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
            <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" /> Previous
          </Btn>
          <div className="flex gap-1.5">
            {deck.slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                aria-label={`Go to slide ${i + 1}`}
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: i === current ? theme.accent : "var(--card-border)" }}
              />
            ))}
          </div>
          <Btn variant="outline" size="sm" onClick={() => setCurrent((c) => Math.min(deck.slides.length - 1, c + 1))} disabled={current >= deck.slides.length - 1}>
            Next <Icon name="arrowRight" size={16} className="ms-1 inline-block align-middle rtl:rotate-180" />
          </Btn>
        </div>
      </Card>

      {/* Editable slides */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Slides ({deck.slides.length})</h2>
          <Btn size="sm" onClick={addSlide}>+ Add slide</Btn>
        </div>
        {deck.slides.map((s, i) => (
          <Card key={i} className={i === current ? "ring-2 ring-[var(--brand2)]" : ""}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Slide {i + 1}</span>
                <div className="flex gap-1">
                  <Btn variant="ghost" size="sm" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label="Move slide up"><Icon name="arrowUp" size={16} /></Btn>
                  <Btn variant="ghost" size="sm" onClick={() => moveSlide(i, 1)} disabled={i === deck.slides.length - 1} aria-label="Move slide down"><Icon name="arrowDown" size={16} /></Btn>
                  <Btn variant="ghost" size="sm" onClick={() => setCurrent(i)}>Preview</Btn>
                  <Btn variant="danger" size="sm" onClick={() => deleteSlide(i)} disabled={deck.slides.length <= 1}>{t("delete")}</Btn>
                </div>
              </div>
              <Field label="Title">
                <Input dir="auto" value={s.title} onChange={(e) => updateSlide(i, { title: e.target.value })} />
              </Field>
              <Field label="Bullets (one per line)">
                <Textarea
                  dir="auto"
                  rows={Math.max(2, s.bullets.length + 1)}
                  value={s.bullets.join("\n")}
                  onChange={(e) => updateSlide(i, { bullets: e.target.value.split("\n") })}
                />
              </Field>
              <Field label="Speaker notes">
                <Input dir="auto" value={s.notes} onChange={(e) => updateSlide(i, { notes: e.target.value })} placeholder="Optional speaker notes" />
              </Field>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="mb-2 text-base font-semibold">{t("export")}</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">
          The exported PPTX uses the selected theme colours.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => handleExport("pptx")} disabled={exporting !== null}>
            {exporting === "pptx" ? "Exporting PPTX…" : "Export PPTX"}
          </Btn>
          <Btn variant="outline" onClick={() => handleExport("pdf")} disabled={exporting !== null}>
            {exporting === "pdf" ? "Exporting PDF…" : "Export PDF"}
          </Btn>
        </div>
        {exporting && <div className="mt-3"><Spinner label={`Building your ${exporting.toUpperCase()}…`} /></div>}
      </Card>
      </div>
    </AppShell>
  );
}
