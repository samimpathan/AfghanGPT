/**
 * lib/freeweb.ts — Free, no-key web answers for Samim AI (server-only).
 *
 * Google Search has NO free no-key API, so this module never calls it.
 * Instead it uses three free public APIs that need no key at all:
 *   1. DuckDuckGo Instant Answer (api.duckduckgo.com)
 *   2. Wikipedia REST summary / search API (language-matched when possible)
 *   3. Google Books (only for book questions)
 *
 * NEVER invent an answer: when no source returns anything useful,
 * getFreeWebAnswer returns null and the caller falls back to the
 * offline brain. Every returned answer carries a source note.
 */

export type FreeWebLang = "ps" | "en" | "fa" | "ar";

export interface FreeWebAnswer {
  text: string;
  source: string;
}

const TIMEOUT_MS = 6000;

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SamimAI/1.0 (free web answers)" },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Best-effort language detection for a question. Pashto-specific
 * letters win; other Arabic-script text defaults to Pashto (the
 * app's main audience) unless it clearly looks like Dari or Arabic. */
export function detectLang(text: string): FreeWebLang {
  if (/[ځڅډړږښګڼېۍ]/.test(text)) return "ps";
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) {
    if (/\b(است|این|چه|کجا|چطور|می‌شود|میشود|های|بود|خواهد)\b/.test(text)) return "fa";
    if (/\b(ما|هل|أين|هذا|هذه|كيف|ماذا|الذي|التي|كان|يكون)\b/.test(text)) return "ar";
    return "ps";
  }
  return "en";
}

const WIKI_LANG: Record<FreeWebLang, string> = {
  ps: "ps",
  en: "en",
  fa: "fa",
  ar: "ar",
};

const SOURCE_NAME: Record<FreeWebLang, { wiki: string; ddg: string; books: string }> = {
  ps: { wiki: "ویکیپیډیا", ddg: "DuckDuckGo", books: "Google Books" },
  en: { wiki: "Wikipedia", ddg: "DuckDuckGo", books: "Google Books" },
  fa: { wiki: "ویکی‌پدیا", ddg: "DuckDuckGo", books: "Google Books" },
  ar: { wiki: "ويكيبيديا", ddg: "DuckDuckGo", books: "Google Books" },
};

const INTRO: Record<FreeWebLang, string> = {
  ps: "دا مې په انټرنیټ کې وموندل:",
  en: "I found this on the web:",
  fa: "این را در اینترنت پیدا کردم:",
  ar: "وجدت هذا على الإنترنت:",
};

const SOURCE_LABEL: Record<FreeWebLang, string> = {
  ps: "سرچینه",
  en: "Source",
  fa: "منبع",
  ar: "المصدر",
};

function compose(fact: string, source: string, lang: FreeWebLang): FreeWebAnswer {
  return {
    text: `${INTRO[lang]}\n\n${fact}\n\n${SOURCE_LABEL[lang]}: ${source}`,
    source,
  };
}

/** Strip question words so "What is the capital of France?" becomes
 * a topic like "capital of France" for the Wikipedia summary API.
 * Trailing question words are stripped FIRST so a phrase like
 * "د فرانسې پلازمېنه څه ده؟" keeps its country ("فرانسې پلازمېنه")
 * instead of being eaten by a leading "د … پلازمېنه" pattern. */
function deriveTopic(question: string): string {
  let q = question
    .replace(/[؟?!.،,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  q = q.replace(/\s+(څه دی|څه ده|څه دي|چیست|کیست|ما هو|ما هي|what is it|is it)\s*$/i, "");
  const patterns: RegExp[] = [
    /^(what is|what are|what was|who is|who was|where is|where are|when is|when was|define|tell me about|explain|meaning of|the capital of|capital of)\s+/i,
    /^(څه دی|څه ده|څه دي|څوک دی|څوک ده|څوک دي|چیرته دی|چیرته ده|کله دی|پایتخت|پلازمېنه)\s+/,
    /^(چیست|کیست|کجاست|پایتخت|تعریف)\s+/,
    /^(ما هو|ما هي|من هو|من هي|أين|عاصمة)\s+/,
  ];
  for (const p of patterns) q = q.replace(p, "");
  const words = q.split(" ").filter(Boolean).slice(0, 6);
  return words.join(" ").trim();
}

/** Content words of a topic — stopwords and 1–2 letter words dropped,
 * so "the" can no longer make "Capital punishment in France" look
 * like an answer to "the capital of France". A search snippet must
 * contain ALL of them to count as an answer. Without this,
 * Wikipedia's first hit is often about a different subject that
 * merely shares one word (e.g. "د فرانسې ازادي" for "فرانسې پلازمېنه"). */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "in", "on", "at", "to",
  "is", "are", "was", "were", "what", "who", "where", "when", "which", "how",
  "د", "په", "کې", "او", "له", "څخه", "ده", "دی", "دي", "که", "چی", "چه",
  "این", "است", "را", "به", "در", "از", "ما", "هو", "هي", "من", "في", "إلى", "عن", "على",
]);

function topicWords(topic: string): string[] {
  return topic.split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
}

function snippetMatches(snippet: string, title: string, words: string[]): boolean {
  if (words.length === 0) return snippet.length > 20;
  const hay = `${title} ${snippet}`.toLowerCase();
  return words.every((w) => hay.includes(w.toLowerCase()));
}

function isBookQuestion(question: string): boolean {
  return /book|کتاب/i.test(question);
}

async function duckDuckGo(question: string, lang: FreeWebLang): Promise<FreeWebAnswer | null> {
  const url =
    "https://api.duckduckgo.com/?q=" +
    encodeURIComponent(question) +
    "&format=json&no_html=1&skip_disambig=1";
  const data = (await fetchJson(url)) as {
    AbstractText?: string;
    AbstractSource?: string;
    Answer?: string;
    RelatedTopics?: Array<{ Text?: string; Topics?: Array<{ Text?: string }> }>;
  } | null;
  if (!data) return null;
  const abstract = (data.AbstractText ?? "").trim();
  if (abstract) {
    const source = (data.AbstractSource ?? "").trim() || "DuckDuckGo";
    return compose(abstract, source, lang);
  }
  const answer = (data.Answer ?? "").trim();
  if (answer) return compose(answer, "DuckDuckGo", lang);
  const topics = data.RelatedTopics ?? [];
  for (const t of topics) {
    const text = (t.Text ?? "").trim();
    if (text.length > 20) return compose(text, "DuckDuckGo", lang);
    const sub = t.Topics ?? [];
    for (const s of sub) {
      const st = (s.Text ?? "").trim();
      if (st.length > 20) return compose(st, "DuckDuckGo", lang);
    }
  }
  return null;
}

async function wikipedia(question: string, lang: FreeWebLang): Promise<FreeWebAnswer | null> {
  const topic = deriveTopic(question);
  const wikiLang = WIKI_LANG[lang];
  const sourceName = SOURCE_NAME[lang].wiki;
  if (topic.length >= 2) {
    const title = encodeURIComponent(topic.replace(/\s+/g, "_"));
    const summary = (await fetchJson(
      `https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${title}`
    )) as { extract?: string; type?: string } | null;
    if (summary && typeof summary.extract === "string" && summary.extract.trim()) {
      return compose(summary.extract.trim(), sourceName, lang);
    }
  }
  // Fallback: search API on the same language Wikipedia, then English.
  // Scan the first few hits and take the first whose title/snippet
  // actually contains every topic word — the top hit is often about
  // a different subject that shares one word.
  const words = topicWords(topic);
  for (const sub of [wikiLang, "en"]) {
    const data = (await fetchJson(
      `https://${sub}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        topic || question
      )}&format=json&origin=*`
    )) as { query?: { search?: Array<{ snippet?: string; title?: string }> } } | null;
    const results = data?.query?.search ?? [];
    const matches = results
      .slice(0, 5)
      .map((hit) => ({ title: hit.title ?? "", snippet: hit.snippet ? stripHtml(hit.snippet) : "" }))
      .filter((m) => m.snippet.length > 20 && snippetMatches(m.snippet, m.title, words));
    // Rank the matches: a hit whose FIRST sentence already states
    // the topic ("پاریس د فرانسې پلازمېنه دی") beats one that merely
    // mentions the words pages later ("...د ازادې فرانسې پلازمېنه
    // شوه"), and a short title ("پاریس") beats a long one
    // ("د فرانسې ازادي") — the article about the thing itself.
    const scored = matches
      .map((m) => {
        const first = m.snippet.split(/[.!؟]/)[0] ?? "";
        const firstStatesTopic = words.every((w) => first.toLowerCase().includes(w.toLowerCase()));
        const titleWords = m.title.split(" ").filter(Boolean).length || 99;
        return { m, score: (firstStatesTopic ? 0 : 10) + titleWords };
      })
      .sort((a, b) => a.score - b.score);
    const best = scored[0]?.m;
    if (best) return compose(best.snippet, sourceName, lang);
  }
  return null;
}

async function googleBooks(question: string, lang: FreeWebLang): Promise<FreeWebAnswer | null> {
  const data = (await fetchJson(
    "https://www.googleapis.com/books/v1/volumes?q=" +
      encodeURIComponent(question) +
      "&maxResults=3"
  )) as {
    items?: Array<{
      volumeInfo?: { title?: string; authors?: string[]; description?: string };
    }>;
  } | null;
  const info = data?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const parts = [info.title];
  if (info.authors?.length) parts.push(`by ${info.authors.join(", ")}`);
  if (info.description) parts.push(stripHtml(info.description).slice(0, 400));
  const fact = parts.join(" — ");
  if (fact.length < 10) return null;
  return compose(fact, SOURCE_NAME[lang].books, lang);
}

/**
 * Free web answer for a question. Tries DuckDuckGo, then Wikipedia,
 * and Google Books for book questions. Returns null when no source
 * has anything useful — the caller must never invent an answer.
 */
export async function getFreeWebAnswer(
  question: string,
  lang: FreeWebLang
): Promise<FreeWebAnswer | null> {
  const q = question.trim();
  if (q.length < 2) return null;
  if (isBookQuestion(q)) {
    return (await googleBooks(q, lang)) ?? (await duckDuckGo(q, lang)) ?? (await wikipedia(q, lang));
  }
  return (await duckDuckGo(q, lang)) ?? (await wikipedia(q, lang));
}
