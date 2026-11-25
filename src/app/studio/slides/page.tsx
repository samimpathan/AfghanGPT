/**
 * /studio/slides — Presentation Maker (Gamma-style): AI outline via
 * chatJson with a strict schema, fully editable slides, themed live
 * preview, real PPTX/PDF export via /api/files, deck saved in
 * localStorage under "samim-slides" for logged-in users only —
 * guests work in memory and the deck dies with the session.
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { chatJson, downloadFileSpec } from "@/lib/client";
import { store } from "@/lib/store";
import {
  STYLES,
  LAST_STYLE_KEY,
  pickStyleForTopic,
  normaliseLayout,
  parsePercentBars,
  hasPercentValue,
  type SlideLayout,
} from "@/lib/slideStyles";
import { fetchSlideImages, type SlideImage } from "@/lib/slideImages";
import { Btn, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

const STORAGE_KEY = "samim-slides";

// R3-D: the 4 app languages, with the script + direction each deck is
// generated and rendered in. The Select below offers all four; the
// generation prompt (handleGenerate) names the script explicitly so a
// Pashto/Dari/Arabic deck does not come back in English.
const LANG_META: Record<string, { label: string; rtl: boolean; scriptNote: string }> = {
  Pashto: { label: "Pashto (پښتو)", rtl: true, scriptNote: "Pashto, written in the Arabic script" },
  Dari: { label: "Dari (دری)", rtl: true, scriptNote: "Dari, written in the Arabic script" },
  English: { label: "English", rtl: false, scriptNote: "English" },
  Arabic: { label: "Arabic (العربية)", rtl: true, scriptNote: "Arabic, written in the Arabic script" },
};

// R3-D: Arabic-script detection, so a saved Pashto/Dari/Arabic deck
// still previews RTL even if the language selector was left on English
// (e.g. after loading a saved deck).
const RTL_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
function isRtlText(s: string): boolean {
  return RTL_RE.test(s);
}

type DeckSlide = {
  title: string;
  bullets: string[];
  notes: string;
  /** Per-slide layout (cover/contents/textImage/imageLed/twoColumn/highlight/chart). */
  layout?: SlideLayout;
  /** Short ENGLISH image search phrase for this slide (from the model). */
  imageQuery?: string;
  /** Fetched topic photo (Openverse/Wikimedia) — null = text-only slide. */
  image?: SlideImage | null;
};
type Deck = { title: string; slides: DeckSlide[] };

// The style set lives in lib/slideStyles.ts (8 styles: the 7 named
// styles from the founder's spec + the AfghanGPT brand blue). The
// retired single-theme record is gone — every new deck gets a style
// picked from its TOPIC, never the previous deck's style.

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
      (s as DeckSlide).bullets.every((b) => typeof b === "string") &&
      ((s as DeckSlide).layout === undefined || typeof (s as DeckSlide).layout === "string") &&
      ((s as DeckSlide).imageQuery === undefined || typeof (s as DeckSlide).imageQuery === "string") &&
      ((s as DeckSlide).image === undefined ||
        (s as DeckSlide).image === null ||
        (typeof (s as DeckSlide).image === "object" && typeof (s as DeckSlide).image?.url === "string"))
  );
}

function normaliseDeck(v: unknown): Deck {
  const d = v as Deck;
  const total = d.slides.length;
  return {
    title: d.title.trim(),
    slides: d.slides.map((s, i) => ({
      title: s.title.trim() || "Untitled slide",
      bullets: s.bullets.map((b) => b.trim()).filter(Boolean),
      notes: typeof s.notes === "string" ? s.notes : "",
      layout: normaliseLayout(s.layout, i, total),
      imageQuery: typeof s.imageQuery === "string" ? s.imageQuery.trim().slice(0, 80) : "",
      image:
        s.image && typeof s.image === "object" && typeof s.image.url === "string" && s.image.url.startsWith("https://")
          ? { url: s.image.url.slice(0, 500), credit: typeof s.image.credit === "string" ? s.image.credit.slice(0, 120) : "", source: s.image.source === "wikimedia" ? "wikimedia" : "openverse" }
          : null,
    })),
  };
}

function slug(s: string): string {
  const clean = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  return clean || "presentation";
}

/** Slide title with the style's font, case and letter spacing. */
function SlideTitle({ children, style, rtl, className }: { children: string; style: (typeof STYLES)[string]; rtl: boolean; className?: string }) {
  const s: CSSProperties = {
    textAlign: rtl ? "right" : "left",
    fontFamily: style.titleFont,
    textTransform: style.titleUppercase ? "uppercase" : "none",
    letterSpacing: style.titleCharSpacing ? `${style.titleCharSpacing}px` : undefined,
  };
  return (
    <h3 dir={rtl ? "rtl" : "ltr"} style={s} className={className ?? "mt-4 break-words text-lg font-bold leading-snug sm:text-2xl"}>
      {children}
    </h3>
  );
}

/** Bullet list (style accent dots, deck direction). */
function SlideBullets({ items, accent, sub, rtl }: { items: string[]; accent: string; sub: string; rtl: boolean }) {
  if (items.length === 0) {
    return <p className="mt-3 text-sm opacity-60">No bullets yet — add some below.</p>;
  }
  return (
    <ul className="mt-3 space-y-1.5 text-sm sm:text-base" style={{ color: sub }}>
      {items.map((b, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="shrink-0" style={{ color: accent }}>•</span>
          <span dir={rtl ? "rtl" : "ltr"} style={{ textAlign: rtl ? "right" : "left" }} className="min-w-0 break-words">{b}</span>
        </li>
      ))}
    </ul>
  );
}

/** Topic photo with its attribution line (always LTR, tiny). */
function SlideImageFigure({ image, alt, className, imgClassName, onError }: { image: SlideImage; alt: string; className?: string; imgClassName: string; onError: () => void }) {
  return (
    <figure className={className}>
      <img src={image.url} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={onError} data-testid="slide-image" className={imgClassName} />
      <figcaption dir="ltr" className="mt-1 break-words text-[10px] leading-tight opacity-60">{image.credit}</figcaption>
    </figure>
  );
}

export default function SlidesPage() {
  const { t } = useLang();
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [audience, setAudience] = useState("General");
  const [language, setLanguage] = useState("English");
  const [styleName, setStyleName] = useState("AfghanGPT");
  const [deck, setDeck] = useState<Deck>(EMPTY_DECK);
  const [current, setCurrent] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [findingImages, setFindingImages] = useState(false);
  const [exporting, setExporting] = useState<"pptx" | "pdf" | null>(null);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  // Images that failed to load in the preview (broken URL etc.) —
  // keyed by URL, so the broken frame is hidden, not shown.
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});
  const loadedRef = useRef(false);
  // Generation id: image fetching runs after generation; the merge
  // only applies if the deck is still the one that was generated
  // (the user may have edited or regenerated meanwhile).
  const genIdRef = useRef(0);

  const style = STYLES[styleName] ?? STYLES.AfghanGPT;

  // Restore the last-used style on every device (guests too — it is
  // a device preference, not user data). The deck itself is only
  // restored for logged-in users (existing rule, unchanged).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAST_STYLE_KEY);
      if (saved && STYLES[saved]) setStyleName(saved);
    } catch {
      /* storage unavailable — keep the default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // DESIGN VARIETY (founder's hard rule): the style is picked
      // from the TOPIC, and the previous deck's style is excluded —
      // two presentations in a row never look alike, even for the
      // same topic twice.
      let lastStyle: string | null = null;
      try {
        lastStyle = window.localStorage.getItem(LAST_STYLE_KEY);
      } catch {
        /* storage unavailable */
      }
      const picked = pickStyleForTopic(topic.trim(), audience, lastStyle);
      setStyleName(picked);
      try {
        window.localStorage.setItem(LAST_STYLE_KEY, picked);
      } catch {
        /* storage unavailable */
      }
      // R3-D: the language instruction is explicit and strong, in BOTH
      // the system prompt and the user prompt — language name + script
      // + "ALL content, no other language" — because the old single
      // "Language: X / write in the requested language" line was weak
      // enough that decks could come back in English.
      const langMeta = LANG_META[language] ?? LANG_META.English;
      const system =
        "You are a presentation outline writer. Reply with ONLY a strict JSON object, no markdown fences, no extra text. " +
        'Schema: {"title":"...","slides":[{"title":"...","bullets":["..."],"notes":"...","layout":"...","imageQuery":"..."}]}. ' +
        "DECK STRUCTURE (always): slide 1 is the COVER (title = the deck title, bullets = exactly ONE subtitle sentence about the topic, layout 'cover'); slide 2 is the CONTENTS (title like 'Contents' / 'فهرست', bullets = 3-5 short section titles of this deck, layout 'contents', imageQuery ''); the last slide is the CONCLUSION (title like 'Conclusion' / 'پایله', bullets = 3-4 short takeaway sentences, layout 'highlight'); the slides in between are the MAIN content. " +
        "LAYOUTS (pick one per slide): 'cover', 'contents', 'textImage' (text + photo side by side), 'imageLed' (big photo, little text), 'twoColumn' (bullets in two columns), 'highlight' (one key number or quote first, then the rest), 'chart' (ONLY when the slide has 2 or more comparable percentages or numbers in its bullets — the chart is drawn from those numbers). Vary the middle slides' layouts — do not use the same layout for every slide. " +
        "Every main slide needs 4-6 substantive bullets. Each bullet must be a complete, informative sentence with real detail about the topic — not a two-word fragment. Fill each slide completely with real content before moving to the next slide: a slide with only one or two short lines is not acceptable. Do not pad with filler and do not repeat the same point in different words. Notes are one sentence of speaker notes. " +
        "IMAGE QUERY: for every slide except the contents slide, write a short ENGLISH image search phrase of 2-4 words in 'imageQuery' — concrete visual nouns ONLY, e.g. 'cloud servers data center', 'silicon wafer factory', 'solar panels roof'. Do NOT use abstract words (global, future, abstract, concept, performance, visualization, connectivity, success, strategy, landscape, environment). Each slide's query must be DIFFERENT — never repeat a query. For the cover, use a strong visual of the whole topic. For the conclusion, use a thematic image or '' if none fits. " +
        `Write the deck title, every slide title, every bullet and every speaker note ENTIRELY in ${langMeta.scriptNote}. ` +
        "Do not write any slide content in any other language — the imageQuery is the ONLY English field.";
      const deckOut = await chatJson<Deck>(
        [
          {
            role: "user",
            content:
              `Create a presentation outline about: ${topic.trim()}\n` +
              `Number of slides: ${n}\nAudience / purpose: ${audience}\n` +
              `Language: ${langMeta.label} — write ALL titles, bullets and notes in ${langMeta.scriptNote}. ` +
              "Structure: first slide cover, second slide contents, last slide conclusion. " +
              "Each main slide must be complete and full: 4-6 substantive bullets per slide, each a complete sentence with real detail. " +
              "Give every slide a layout and an English imageQuery (2-4 concrete visual words, different per slide, contents slide: ''). " +
              "Do not use English for any slide content, except a proper noun or technical term that has no translation in that language.",
          },
        ],
        system,
        "smart"
      );
      if (!isDeck(deckOut)) throw new Error("bad-json");
      const fresh = normaliseDeck(deckOut);
      setDeck(fresh);
      setCurrent(0);
      // TOPIC IMAGES: fetch one real photo per slide (free sources,
      // no key) from each slide's own imageQuery. Runs AFTER the deck
      // is shown, so the user never waits on pictures; a slide with
      // no good match simply stays text-only.
      const genId = ++genIdRef.current;
      const queries = fresh.slides.map((s) => (s.layout === "contents" ? "" : s.imageQuery ?? ""));
      if (queries.some(Boolean)) {
        setFindingImages(true);
        void fetchSlideImages(queries).then((images) => {
          setFindingImages(false);
          if (genId !== genIdRef.current) return;
          setDeck((d) => {
            // Only merge if the deck is still the generated one
            // (titles unchanged) — the user may have edited meanwhile.
            if (d.slides.length !== fresh.slides.length) return d;
            if (!d.slides.every((s, i) => s.title === fresh.slides[i].title)) return d;
            return {
              ...d,
              slides: d.slides.map((s, i) => (images[i] ? { ...s, image: images[i] } : s)),
            };
          });
        });
      }
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
            slides: deck.slides.map((s) => ({
              title: s.title,
              bullets: s.bullets,
              notes: s.notes || undefined,
              layout: s.layout,
              image: s.image ? { url: s.image.url, credit: s.image.credit } : undefined,
            })),
            theme: {
              bg: style.bg,
              accent: style.accent,
              text: style.text,
              sub: style.sub,
              card: style.card,
              titleFont: style.titleFont,
              bodyFont: style.bodyFont,
              titleUppercase: style.titleUppercase,
              titleCharSpacing: style.titleCharSpacing,
              accentBar: style.accentBar,
            },
            rtl: deckRtl,
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
          pdf: { title: deck.title || topic || "Presentation", lines, rtl: deckRtl },
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
  const slideBullets = slide?.bullets.filter(Boolean) ?? [];
  const slideLayout: SlideLayout = slide?.layout ?? "textImage";
  const slideImage = slide?.image && !imgFailed[slide.image.url] ? slide.image : null;
  const slideBars = slideLayout === "chart" ? parsePercentBars(slideBullets) : null;
  // Bullets that did not parse into chart bars still show below the chart.
  const chartRest = slideBars ? slideBullets.filter((b) => !hasPercentValue(b)) : [];

  // R3-D: the preview + editor render in the deck language's direction.
  // The selector wins; Arabic-script content wins as a fallback (a
  // saved Pashto deck loaded while the selector still says English).
  const langMeta = LANG_META[language] ?? LANG_META.English;
  const deckRtl =
    langMeta.rtl ||
    isRtlText(slide?.title ?? "") ||
    isRtlText(slide?.bullets?.find(Boolean) ?? "");

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
            <Field label="Style">
              <Select
                value={styleName}
                onChange={(e) => {
                  const next = e.target.value;
                  setStyleName(next);
                  try {
                    window.localStorage.setItem(LAST_STYLE_KEY, next);
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                {Object.values(STYLES).map((s) => (
                  <option key={s.name} value={s.name}>{s.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Btn onClick={handleGenerate} disabled={generating || !topic.trim()} className="w-full">
            {generating ? "Generating outline…" : "Generate outline"}
          </Btn>
          {generating && <Spinner label="Asking the AI for an outline…" />}
          {findingImages && <p className="text-xs text-[var(--muted)]">Finding topic pictures… (slides stay usable without them)</p>}
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
          // R3-D: explicit deck direction (was dir="auto" on the whole
          // card, which left RTL alignment to chance). The text nodes
          // now ALSO follow the deck direction instead of dir="auto":
          // dir="auto" resolves each line from its FIRST strong
          // character, so the hardcoded Latin "Notes: " prefix flipped
          // the notes paragraph LTR, and any bullet starting with an
          // English word or a number flipped that bullet LTR too —
          // the founder's mixed Pashto+English slides came out
          // jumbled (bullet + number at the wrong end, English terms
          // displaced). With the deck direction, a Pashto deck is RTL
          // throughout and English terms still embed correctly via
          // the bidi algorithm (e.g. "د ویفر (Wafer) جوړول" keeps
          // (Wafer) in place). On phones the card grows to fit
          // the slide instead of aspect-video + overflow-hidden, which
          // silently clipped long slides; on sm+ it keeps 16:9 but
          // scrolls internally rather than clipping.
          // LAYOUTS: the slide renders per its layout (cover,
          // contents, textImage, imageLed, twoColumn, highlight,
          // chart) with the style's fonts + accent bar; a slide with
          // no image renders the same layout text-only.
          <div
            data-testid="slide-preview"
            className="min-h-[220px] w-full overflow-y-auto rounded-xl p-4 sm:aspect-video sm:p-8"
            style={{
              background: style.bg,
              color: style.text,
              fontFamily: style.bodyFont,
              borderInlineStart: style.accentBar === "side" ? `4px solid ${style.accent}` : undefined,
            }}
            dir={deckRtl ? "rtl" : "ltr"}
          >
            {style.accentBar === "top" && (
              <div className="h-1.5 w-16 rounded-full" style={{ background: style.accent }} />
            )}
            {slideLayout === "cover" ? (
              <>
                {slideImage && (
                  <SlideImageFigure
                    image={slideImage}
                    alt={slide.title}
                    className="mb-4"
                    imgClassName="h-40 w-full rounded-lg object-cover sm:h-52"
                    onError={() => setImgFailed((f) => ({ ...f, [slideImage.url]: true }))}
                  />
                )}
                <SlideTitle style={style} rtl={deckRtl} className="mt-2 break-words text-2xl font-bold leading-snug sm:text-3xl">{slide.title}</SlideTitle>
                {slideBullets[0] && (
                  <p dir={deckRtl ? "rtl" : "ltr"} style={{ textAlign: deckRtl ? "right" : "left", color: style.sub }} className="mt-3 break-words text-base leading-relaxed">{slideBullets[0]}</p>
                )}
                {slideBullets.length > 1 && (
                  <SlideBullets items={slideBullets.slice(1)} accent={style.accent} sub={style.sub} rtl={deckRtl} />
                )}
              </>
            ) : slideLayout === "contents" ? (
              <>
                <SlideTitle style={style} rtl={deckRtl}>{slide.title}</SlideTitle>
                <ol className="mt-4 space-y-2.5">
                  {slideBullets.map((b, i) => (
                    <li key={i} className="flex gap-3 text-sm sm:text-base">
                      <span className="shrink-0 font-bold" style={{ color: style.accent }}>{i + 1}.</span>
                      <span dir={deckRtl ? "rtl" : "ltr"} style={{ textAlign: deckRtl ? "right" : "left", color: style.sub }} className="min-w-0 break-words">{b}</span>
                    </li>
                  ))}
                  {slideBullets.length === 0 && <li className="text-sm opacity-60">No sections yet — add some below.</li>}
                </ol>
              </>
            ) : slideLayout === "imageLed" ? (
              <>
                {slideImage && (
                  <SlideImageFigure
                    image={slideImage}
                    alt={slide.title}
                    className="mb-4"
                    imgClassName="h-44 w-full rounded-lg object-cover sm:h-56"
                    onError={() => setImgFailed((f) => ({ ...f, [slideImage.url]: true }))}
                  />
                )}
                <SlideTitle style={style} rtl={deckRtl}>{slide.title}</SlideTitle>
                <SlideBullets items={slideBullets} accent={style.accent} sub={style.sub} rtl={deckRtl} />
              </>
            ) : slideLayout === "textImage" ? (
              <div className="sm:grid sm:grid-cols-[1fr_180px] sm:gap-4">
                <div className="min-w-0">
                  <SlideTitle style={style} rtl={deckRtl} className="mt-0 break-words text-lg font-bold leading-snug sm:text-2xl">{slide.title}</SlideTitle>
                  <SlideBullets items={slideBullets} accent={style.accent} sub={style.sub} rtl={deckRtl} />
                </div>
                {slideImage && (
                  <SlideImageFigure
                    image={slideImage}
                    alt={slide.title}
                    className="mt-4 sm:mt-0"
                    imgClassName="h-36 w-full rounded-lg object-cover sm:h-44"
                    onError={() => setImgFailed((f) => ({ ...f, [slideImage.url]: true }))}
                  />
                )}
              </div>
            ) : slideLayout === "twoColumn" ? (
              <>
                <SlideTitle style={style} rtl={deckRtl}>{slide.title}</SlideTitle>
                {slideImage && (
                  <SlideImageFigure
                    image={slideImage}
                    alt={slide.title}
                    className="mt-3"
                    imgClassName="h-28 w-full rounded-lg object-cover sm:h-32"
                    onError={() => setImgFailed((f) => ({ ...f, [slideImage.url]: true }))}
                  />
                )}
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2 sm:gap-4">
                  <SlideBullets items={slideBullets.slice(0, Math.ceil(slideBullets.length / 2))} accent={style.accent} sub={style.sub} rtl={deckRtl} />
                  <SlideBullets items={slideBullets.slice(Math.ceil(slideBullets.length / 2))} accent={style.accent} sub={style.sub} rtl={deckRtl} />
                </div>
              </>
            ) : slideLayout === "highlight" ? (
              <div className="sm:grid sm:grid-cols-[1fr_140px] sm:gap-4">
                <div className="min-w-0">
                  <SlideTitle style={style} rtl={deckRtl}>{slide.title}</SlideTitle>
                  {slideBullets[0] && (
                    <p dir={deckRtl ? "rtl" : "ltr"} style={{ textAlign: deckRtl ? "right" : "left", background: style.card, color: style.accent }} className="mt-4 break-words rounded-xl p-3 text-lg font-bold leading-snug sm:text-xl">{slideBullets[0]}</p>
                  )}
                  <SlideBullets items={slideBullets.slice(1)} accent={style.accent} sub={style.sub} rtl={deckRtl} />
                </div>
                {slideImage && (
                  <SlideImageFigure
                    image={slideImage}
                    alt={slide.title}
                    className="mt-4 sm:mt-0"
                    imgClassName="h-28 w-full rounded-lg object-cover sm:h-full"
                    onError={() => setImgFailed((f) => ({ ...f, [slideImage.url]: true }))}
                  />
                )}
              </div>
            ) : slideLayout === "chart" && slideBars ? (
              <>
                <SlideTitle style={style} rtl={deckRtl}>{slide.title}</SlideTitle>
                <div className="mt-4 space-y-3">
                  {slideBars.map((bar) => (
                    <div key={bar.label}>
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span dir={deckRtl ? "rtl" : "ltr"} className="min-w-0 break-words" style={{ color: style.sub }}>{bar.label}</span>
                        <span className="shrink-0 font-bold" style={{ color: style.accent }}>{bar.value}%</span>
                      </div>
                      <div className="mt-1 h-2.5 w-full rounded-full" style={{ background: style.card }}>
                        <div className="h-2.5 rounded-full" style={{ width: `${Math.min(100, bar.value)}%`, background: style.accent }} />
                      </div>
                    </div>
                  ))}
                </div>
                {chartRest.length > 0 && (
                  <SlideBullets items={chartRest} accent={style.accent} sub={style.sub} rtl={deckRtl} />
                )}
              </>
            ) : (
              <>
                <SlideTitle style={style} rtl={deckRtl}>{slide.title}</SlideTitle>
                <SlideBullets items={slideBullets} accent={style.accent} sub={style.sub} rtl={deckRtl} />
              </>
            )}
            {slide.notes.trim() && (
              <p dir={deckRtl ? "rtl" : "ltr"} style={{ textAlign: deckRtl ? "right" : "left" }} className="mt-4 break-words text-xs italic opacity-70"><span dir="ltr">Notes: </span>{slide.notes}</p>
            )}
            {style.accentBar === "bottom" && (
              <div className="mt-4 h-1.5 w-16 rounded-full" style={{ background: style.accent }} />
            )}
          </div>
        )}
        {/* R3-D: the nav row is FORCED dir="ltr" (same trick as the
            AppShell header): Previous is physically LEFT and Next is
            physically RIGHT in every language. The old flex row flipped
            with the page direction, so in the user's RTL screenshot
            Next sat on the left and Previous on the right. The arrows
            no longer rotate — in this LTR row left-arrow = Previous
            (left) and right-arrow = Next (right), always. The dots row
            can wrap and never squeezes the buttons, so 15 slides fit
            at 390px. */}
        <div dir="ltr" className="mt-3 flex items-center justify-between gap-2">
          <Btn variant="outline" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
            <Icon name="arrowLeft" size={16} className="inline-block align-middle" /> Previous
          </Btn>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-center gap-1.5 px-1">
            {deck.slides.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrent(i)}
                aria-label={`Go to slide ${i + 1}`}
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: i === current ? style.accent : "var(--card-border)" }}
              />
            ))}
          </div>
          <Btn variant="outline" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setCurrent((c) => Math.min(deck.slides.length - 1, c + 1))} disabled={current >= deck.slides.length - 1}>
            Next <Icon name="arrowRight" size={16} className="ms-1 inline-block align-middle" />
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
              {/* R3-D: this row used to be a single no-wrap flex row with
                  4 buttons + the label in ~330px, so the red Delete
                  button («رنګ کړه») wrapped to two lines and rendered
                  as a tall red block (user's screenshot). The buttons
                  are now nowrap + shrink-0 and the row may wrap, so
                  nothing wraps inside a button and overflow drops to a
                  second line gracefully instead. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Slide {i + 1}</span>
                <div className="flex flex-wrap gap-1">
                  <Btn variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label="Move slide up"><Icon name="arrowUp" size={16} /></Btn>
                  <Btn variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => moveSlide(i, 1)} disabled={i === deck.slides.length - 1} aria-label="Move slide down"><Icon name="arrowDown" size={16} /></Btn>
                  <Btn variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => setCurrent(i)}>Preview</Btn>
                  <Btn variant="danger" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => deleteSlide(i)} disabled={deck.slides.length <= 1}>{t("delete")}</Btn>
                </div>
              </div>
              <Field label="Title">
                <Input dir="auto" value={s.title} onChange={(e) => updateSlide(i, { title: e.target.value })} />
              </Field>
              <Field label="Layout">
                <Select value={s.layout ?? "textImage"} onChange={(e) => updateSlide(i, { layout: e.target.value as SlideLayout })}>
                  <option value="cover">Cover</option>
                  <option value="contents">Contents</option>
                  <option value="textImage">Text + image</option>
                  <option value="imageLed">Image-led</option>
                  <option value="twoColumn">Two columns</option>
                  <option value="highlight">Highlight</option>
                  <option value="chart">Chart (from the slide numbers)</option>
                </Select>
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
          The exported PPTX uses the selected style (colours, fonts, layout) with the topic pictures embedded.
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
