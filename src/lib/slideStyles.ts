/**
 * lib/slideStyles.ts — Presentation styles for the Slides Studio.
 * Pure TypeScript, no browser or Node dependencies (unit-testable).
 *
 * A STYLE is a whole design, not just a colour swap: background,
 * card, accent, text/sub colours, title + body fonts, title case,
 * letter spacing and the accent-bar treatment. The founder's rule
 * (2026-11-25): every new presentation gets a NEW and SUITABLE
 * design — the style is picked from the TOPIC, and the previous
 * deck's style is never auto-copied (last-style exclusion).
 */

export type SlideLayout =
  | "cover"
  | "contents"
  | "textImage"
  | "imageLed"
  | "twoColumn"
  | "highlight"
  | "chart";

export const LAYOUTS: SlideLayout[] = [
  "cover",
  "contents",
  "textImage",
  "imageLed",
  "twoColumn",
  "highlight",
  "chart",
];

export type AccentBar = "top" | "side" | "bottom" | "none";

export type SlideStyle = {
  /** Key used in the Select + localStorage. */
  name: string;
  /** Human label shown in the Select. */
  label: string;
  /** Slide canvas colour. */
  bg: string;
  /** Card / panel colour on the canvas. */
  card: string;
  /** Accent colour (bars, bullets, numbers, chart bars). */
  accent: string;
  /** Main text colour. */
  text: string;
  /** Secondary text colour. */
  sub: string;
  /** CSS font-family stack for titles (first family is the PPTX face). */
  titleFont: string;
  /** CSS font-family stack for body text. */
  bodyFont: string;
  /** Titles rendered in ALL CAPS (Latin text only — Arabic script is unaffected). */
  titleUppercase: boolean;
  /** Title letter spacing in px (preview) / pt (PPTX). */
  titleCharSpacing: number;
  /** Where the style's accent bar sits on a slide. */
  accentBar: AccentBar;
};

const SANS = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
const SERIF = `Georgia, "Times New Roman", serif`;

/** The full style set: the 7 named styles from the founder's spec
 * plus the AfghanGPT brand blue (kept as one of the set). */
export const STYLES: Record<string, SlideStyle> = {
  AfghanGPT: {
    name: "AfghanGPT",
    label: "AfghanGPT",
    bg: "#12275E",
    card: "#1B3570",
    accent: "#3B82F6",
    text: "#FFFFFF",
    sub: "#C7D6F5",
    titleFont: SANS,
    bodyFont: SANS,
    titleUppercase: false,
    titleCharSpacing: 0,
    accentBar: "top",
  },
  Minimal: {
    name: "Minimal",
    label: "Modern Minimal",
    bg: "#F8FAFC",
    card: "#FFFFFF",
    accent: "#2563EB",
    text: "#0F172A",
    sub: "#475569",
    titleFont: SANS,
    bodyFont: SANS,
    titleUppercase: false,
    titleCharSpacing: 0,
    accentBar: "none",
  },
  Corporate: {
    name: "Corporate",
    label: "Professional Corporate",
    bg: "#0F2A43",
    card: "#16344F",
    accent: "#C9A227",
    text: "#FFFFFF",
    sub: "#CBD5E1",
    titleFont: SANS,
    bodyFont: SANS,
    titleUppercase: true,
    titleCharSpacing: 1,
    accentBar: "side",
  },
  Academic: {
    name: "Academic",
    label: "Academic",
    bg: "#FAF7F0",
    card: "#FFFFFF",
    accent: "#B45309",
    text: "#1C1917",
    sub: "#57534E",
    titleFont: SERIF,
    bodyFont: SERIF,
    titleUppercase: false,
    titleCharSpacing: 0,
    accentBar: "top",
  },
  Technology: {
    name: "Technology",
    label: "Technology / Futuristic",
    bg: "#05070F",
    card: "#0D1526",
    accent: "#00D4FF",
    text: "#EAF2FF",
    sub: "#94A3B8",
    titleFont: SANS,
    bodyFont: SANS,
    titleUppercase: true,
    titleCharSpacing: 2,
    accentBar: "top",
  },
  Creative: {
    name: "Creative",
    label: "Creative Colorful",
    bg: "#6D28D9",
    card: "#7C3AED",
    accent: "#FBBF24",
    text: "#FFFFFF",
    sub: "#EDE9FE",
    titleFont: SANS,
    bodyFont: SANS,
    titleUppercase: false,
    titleCharSpacing: 0,
    accentBar: "none",
  },
  Elegant: {
    name: "Elegant",
    label: "Elegant Dark",
    bg: "#171412",
    card: "#221D19",
    accent: "#D4AF37",
    text: "#F5F0E8",
    sub: "#C9BFAF",
    titleFont: SERIF,
    bodyFont: SERIF,
    titleUppercase: false,
    titleCharSpacing: 0,
    accentBar: "bottom",
  },
  Scientific: {
    name: "Scientific",
    label: "Scientific / Research",
    bg: "#FFFFFF",
    card: "#F0FDF9",
    accent: "#0D9488",
    text: "#0F172A",
    sub: "#475569",
    titleFont: SANS,
    bodyFont: SANS,
    titleUppercase: false,
    titleCharSpacing: 0,
    accentBar: "side",
  },
};

export const STYLE_NAMES = Object.keys(STYLES);

/** localStorage key for the current / last-used style (device
 * preference — guests too, not user data). */
export const LAST_STYLE_KEY = "samim-slides-style";

/** First font family of a CSS stack, as a PPTX font face name.
 * System stacks resolve to Arial (a real PowerPoint font). */
export function fontFace(stack: string): string {
  const first = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
  if (!first || first.startsWith("-") || first === "system-ui") return "Arial";
  return first;
}

// ---------------------------------------------------------------------------
// Topic -> style selection
// ---------------------------------------------------------------------------

/** Keywords per style, English + Pashto/Dari (Arabic script) — the
 * topic is matched case-insensitively as substrings. */
const STYLE_KEYWORDS: Record<string, string[]> = {
  Technology: [
    "cloud", "comput", "software", "hardware", "silicon", "chip", "artificial", "machine learn",
    "data", "database", "network", "internet", "web", "app", "code", "program", "digital",
    "tech", "cyber", "robot", "algorithm", "server", "device", "smart", "electronic",
    "phone", "mobile", "wifi", "wi-fi", "5g", "blockchain", "crypto", "ai",
    "کمپیوټر", "کمپیوټینګ", "کلاود", "ټکنالوژي", "تکنالوژي", "ټیکنالوژي", "انټرنېټ", "سافټویر", "هارډویر", "مصنوعي",
    "ډیټا", "ډیټابیس", "شبک", "ویب", "اپ", "پروګرام", "ډیجیټل", "روباټ", "سرور",
    "سمارټ", "برېښنايي", "موبایل", "چپ", "سیلیکون", "الګوریتم",
  ],
  Corporate: [
    "business", "marketing", "sales", "startup", "entrepreneur", "finance", "invest",
    "strategy", "management", "leadership", "company", "corporate", "brand", "customer",
    "market", "economy", "trade", "profit", "revenue", "growth",
    "سوداګري", "بازار موندنه", "بازارموندنه", "پلور", "شرکت", "اقتصاد", "پانګه",
    "مدیریت", "ستراتیژي", "ګټه", "پېرودونکي", "سوداګر", "بازار",
  ],
  Academic: [
    "university", "college", "school", "education", "learn", "study", "research", "thesis",
    "academic", "lecture", "student", "teacher", "history", "literature", "language",
    "philosophy", "curriculum",
    "پوهنتون", "ښوونځ", "زده کړه", "زده‌کړه", "څېړنه", "څیړنه", "پوهه", "زده کوونکي",
    "ښوونکی", "تاریخ", "ادبیات", "ژبه", "فلسفه", "تحقیق",
  ],
  Scientific: [
    "science", "scientific", "biology", "chemistry", "physics", "medicine", "medical",
    "health", "disease", "experiment", "laboratory", "environment", "climate", "water",
    "pollution", "energy", "ecology", "anatomy", "psychology", "math", "statistic",
    "ساینس", "بیولوژي", "کیمیا", "فزیک", "طب", "روغتیا", "ناروغي", "تجربه",
    "لابراتوار", "چاپېریال", "اقلیم", "اوبه", "اوبو", "ککړتیا", "انرژي", "ارواپوهنه",
    "ریاضي", "احصایه",
  ],
  Creative: [
    "art", "design", "music", "story", "stories", "children", "kids", "creative",
    "colour", "color", "fashion", "photograph", "film", "movie", "poetry", "drawing",
    "painting", "craft", "culture", "festival",
    "هنر", "ډیزاین", "موسیقي", "کیسه", "ماشوم", "تخلیقي", "رنګ", "فېشن",
    "عکاسي", "فلم", "شعر", "نقاشي", "کلتور", "جشن",
  ],
  Elegant: [
    "luxury", "elegant", "premium", "wedding", "architecture", "interior", "hotel",
    "travel", "tourism", "gallery", "museum", "classic", "heritage", "royal",
    "لوکس", "ښکلی", "واده", "معماري", "هوټل", "سفر", "سیاحت", "موزیم", "میراث",
  ],
  AfghanGPT: [
    "afghan", "afghanistan", "kabul", "devconnect", "community",
    "افغانستان", "افغان", "کابل",
  ],
  // Minimal has no keywords: it is the fallback for topics with no
  // strong signal (and reachable through the hash rotation).
  Minimal: [],
};

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Small audience nudge (weaker than a topic keyword hit, so the
 * topic itself always decides: a tech topic for Education is still
 * Technology, not Academic). */
const AUDIENCE_BOOST: Record<string, Record<string, number>> = {
  Business: { Corporate: 2 },
  Education: { Academic: 2, Scientific: 1 },
  General: {},
};

/**
 * Pick the style for a new deck from the topic + audience.
 * - Scores every style by keyword hits in topic + audience.
 * - The previous deck's style (lastStyleName) is EXCLUDED, so two
 *   decks in a row never look alike — even the same topic twice.
 * - Ties / no keyword hits: deterministic rotation from a hash of
 *   the topic, so different topics spread across the styles.
 * Returns a style name from STYLES (never the last style, unless it
 * is the only style — impossible with 8 styles).
 */
export function pickStyleForTopic(
  topic: string,
  audience: string,
  lastStyleName?: string | null
): string {
  const topicLower = topic.toLowerCase();
  const boost = AUDIENCE_BOOST[audience] ?? {};
  const scored = STYLE_NAMES.map((name) => {
    const hits = (STYLE_KEYWORDS[name] ?? []).filter((k) => k && topicLower.includes(k.toLowerCase())).length;
    // A topic keyword hit counts 3x an audience nudge — the topic
    // decides the style; the audience only breaks weak ties.
    return { name, hits: hits * 3 + (boost[name] ?? 0) };
  });
  const pool = scored.filter((s) => s.name !== lastStyleName);
  const hash = hashStr(`${topicLower} ${audience.toLowerCase()}`);
  pool.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    // Deterministic tiebreak: rotate by hash so different topics
    // land on different styles even with equal scores.
    const ai = STYLE_NAMES.indexOf(a.name);
    const bi = STYLE_NAMES.indexOf(b.name);
    return ((ai + hash) % STYLE_NAMES.length) - ((bi + hash) % STYLE_NAMES.length);
  });
  return pool[0]?.name ?? "AfghanGPT";
}

// ---------------------------------------------------------------------------
// Layout normalisation + chart parsing
// ---------------------------------------------------------------------------

/**
 * Validate a model-supplied layout and enforce the deck structure:
 * slide 0 is always the cover, slide 1 (when there are 3+ slides)
 * is always the contents, the last slide is always the highlight
 * (conclusion). Middle slides keep the model's layout when valid,
 * otherwise rotate textImage / imageLed / twoColumn by position.
 */
export function normaliseLayout(
  raw: unknown,
  index: number,
  total: number
): SlideLayout {
  if (total >= 3) {
    if (index === 0) return "cover";
    if (index === 1) return "contents";
    if (index === total - 1) return "highlight";
  }
  if (typeof raw === "string" && (LAYOUTS as string[]).includes(raw)) {
    // A model "chart" only stands if the bullets parse into bars;
    // that check happens at render time (parsePercentBars) — the
    // layout value itself is valid here.
    return raw as SlideLayout;
  }
  const rotation: SlideLayout[] = ["textImage", "imageLed", "twoColumn"];
  return rotation[index % rotation.length];
}

export type PercentBar = { label: string; value: number };

/** Eastern Arabic-Indic digits (۰-۹ / ٠-٩) to ASCII, so "۶۰ سلنه"
 * parses like "60%". */
const EASTERN_DIGITS: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
function normaliseDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => EASTERN_DIGITS[d] ?? d);
}

/** A "65%", "65 percent", "۶۰ سلنه" or "۶۰ فیصدي" figure in the text.
 * The model writes percentages as words as often as with the % sign,
 * and Pashto/Dari use Eastern Arabic digits — all of those count. */
export function hasPercentValue(text: string): boolean {
  return /(\d+(?:\.\d+)?)\s*(%|percent|percentage|سلنه|فیصدي|فيصدي)/i.test(normaliseDigits(text));
}

/**
 * Parse comparable percentages out of a slide's own bullets, e.g.
 * "Solar: 45%" / "Wind: 30%" -> bars. Returns null unless at least
 * two bullets carry a 0-100% figure — a chart is only drawn from
 * numbers the slide already states; nothing is ever invented.
 */
export function parsePercentBars(bullets: string[]): PercentBar[] | null {
  const bars: PercentBar[] = [];
  for (const b of bullets) {
    const norm = normaliseDigits(b);
    const m = /(\d+(?:\.\d+)?)\s*(%|percent|percentage|سلنه|فیصدي|فيصدي)/i.exec(norm);
    if (!m) continue;
    const value = Number(m[1]);
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    // Label = the text before the number, minus leading markers.
    let label = norm
      .slice(0, m.index)
      .replace(/^\s*(?:[•\-–·\d]+[.)\s]*)+/, "")
      .replace(/[:：\-–—]\s*$/, "")
      .trim();
    if (!label) label = `Item ${bars.length + 1}`;
    bars.push({ label: label.slice(0, 40), value });
  }
  return bars.length >= 2 ? bars : null;
}
