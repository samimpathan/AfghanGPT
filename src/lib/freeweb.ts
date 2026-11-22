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
 *
 * ROUND 4: two guards stop off-topic answers (e.g. "first line /
 * second line" once returned a snippet about the Cunard Line):
 *   - isFactualQuestion(): only clear factual questions are ever
 *     web-searched; greetings, small talk and vague phrases are not.
 *   - Relevance matching: every candidate (DuckDuckGo abstract /
 *     answer / related topic, Wikipedia summary, book result) must
 *     contain the question's content words, or it is dropped.
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
    text: `${INTRO[lang]}\n\n${cleanFactText(fact, lang)}\n\n${SOURCE_LABEL[lang]}: ${source}`,
    source,
  };
}

/** Bracketed Wikipedia-style markup — citation numbers, [update],
 * [citation needed], [edit] … — never part of the answer itself.
 * Only digits and known markup words are stripped, so a legitimate
 * bracketed phrase in real content is left alone. */
const MARKUP_WORDS =
  /^(citation needed|edit|update|clarify|when|where|who|what|which|by whom|page needed|disambiguation|pronunciation|needs? citation|needs? update|verify|dubious|failed verification)$/i;

function stripMarkup(s: string): string {
  return s.replace(/\[[^\]\n]{1,40}\]/g, (m) => {
    const inner = m.slice(1, -1).trim();
    if (/^[\d,\s–—-]+$/.test(inner)) return "";
    if (MARKUP_WORDS.test(inner)) return "";
    return m;
  });
}

const SENTENCE_END = /[.!؟?۔]/;

/** Cut text at the last complete sentence within maxLen — never
 * mid-sentence. If the first sentence alone is longer than maxLen,
 * keep that one sentence whole instead of cutting it. */
function truncateAtSentence(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const head = text.slice(0, maxLen);
  let cut = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    if (SENTENCE_END.test(head[i]) && (i === head.length - 1 || /\s/.test(head[i + 1]))) {
      cut = i + 1;
      break;
    }
  }
  if (cut > 0) return head.slice(0, cut).trim();
  const first = text.match(/^[^.!؟?۔]+[.!؟?۔]/);
  if (first) return first[0].trim();
  return text.trim();
}

/** Clean a web-source fact before it reaches the user: strip
 * Wikipedia markup, fix "word ," spacing, collapse whitespace,
 * and never end mid-sentence. */
function cleanFactText(fact: string, lang: FreeWebLang): string {
  let s = stripMarkup(fact);
  // An ellipsis left by a search snippet counts as a sentence end.
  s = s.replace(/…/g, ".").replace(/\.{3,}/g, ".");
  s = s.replace(/\s+([,.،۔؟!;:])/g, "$1");
  s = s.replace(/\(\s*\)/g, ""); // empty parens left by a removed fragment
  s = s.replace(/\s+/g, " ").trim();
  s = truncateAtSentence(s, 600);
  // End at a real sentence boundary: some sources (DuckDuckGo
  // abstracts) end a complete sentence without a final full stop.
  if (s && !SENTENCE_END.test(s[s.length - 1])) {
    s += lang === "en" ? "." : "۔";
  }
  return s;
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
  return topic
    .split(" ")
    .map((w) => w.replace(/^[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F]+|[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F]+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
}

function snippetMatches(snippet: string, title: string, words: string[]): boolean {
  if (words.length === 0) return snippet.length > 20;
  const hay = `${title} ${snippet}`.toLowerCase();
  return words.every((w) => hay.includes(w.toLowerCase()));
}

/** The question's key phrase ("capital of France", "wrote Hamlet",
 * "د فرانسې پلازمېنه") — the question minus its leading question
 * words and trailing "?", but keeping the topic words in order.
 * A candidate that does not contain this phrase (when it has more
 * than one word) is about a different subject that merely shares
 * words — e.g. the magazine "Capital" shares "capital"+"France"
 * with "capital of France" but never says "capital of France". */
function derivePhrase(question: string): string {
  let q = question
    .replace(/[؟?!.،,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  q = q.replace(/\s+(څه دی|څه ده|څه دي|چیست|کیست|ما هو|ما هي|what is it|is it)\s*$/i, "");
  const patterns: RegExp[] = [
    /^(what is|what are|what was|who is|who was|where is|where are|when is|when was|define|tell me about|explain|meaning of)\s+/i,
    /^(څه دی|څه ده|څه دي|څوک دی|څوک ده|څوک دي|چیرته دی|چیرته ده|کله دی)\s+/,
    /^(چیست|کیست|کجاست|تعریف)\s+/,
    /^(ما هو|ما هي|من هو|من هي|أين)\s+/,
  ];
  for (const p of patterns) q = q.replace(p, "");
  q = q.replace(/^the\s+/i, "");
  return q.trim();
}

function phraseIn(text: string, phrase: string): boolean {
  return phrase.length > 0 && text.toLowerCase().includes(phrase);
}

/** How many of the question's content words a candidate must contain
 * to count as on-topic: ALL of them for 1–2 words, at least two
 * thirds for longer questions. "Capital punishment" shares only
 * "capital" with "capital of France", so it fails; "Cunard Line"
 * shares only "line" with "first line / second line", so it fails. */
function requiredMatchCount(wordCount: number): number {
  if (wordCount <= 2) return wordCount;
  return Math.ceil((wordCount * 2) / 3);
}

/** True when a candidate text (plus its title) contains enough of
 * the question's content words to be about the same topic. */
function matchesTopic(text: string, title: string, words: string[]): boolean {
  if (words.length === 0) return text.length > 20;
  const hay = `${title} ${text}`.toLowerCase();
  const found = words.filter((w) => hay.includes(w.toLowerCase())).length;
  return found >= requiredMatchCount(words.length);
}

/* ================= Factual-question classifier =================
 * Only a message that CLEARLY looks like a factual/informational
 * question may be web-searched. Everything else — greetings, small
 * talk, thanks, goodbyes, vague phrases, statements — goes to the
 * offline brain, which answers honestly instead of returning a
 * loosely-related web snippet. Default: NOT factual. */

const QUESTION_WORDS = [
  "what", "who", "whom", "whose", "where", "when", "why", "how", "which",
  "څه", "څوک", "چیرته", "چېرته", "کله", "ولې", "څنګه", "کوم", "څومره",
  "چه", "چی", "کی", "کجا", "چرا", "چگونه", "چطور", "کدام", "چقدر",
  "ما", "من", "أين", "اين", "متى", "لماذا", "كيف", "ماذا", "أي", "كم",
];

/** Factual topic patterns — these make a message factual even
 * without a leading question word ("the capital of France"). */
const FACTUAL_PATTERNS: RegExp[] = [
  /\bcapital of\b/i, /پلازمېنه/, /پایتخت/, /عاصمة/,
  /\bpopulation of\b/i, /\bmeaning of\b/i, /\bdefinition of\b/i,
  /\bdefine\b/i, /\btell me about\b/i, /\bexplain\b/i,
  /معنی|معنا/, /تعریف/, /تشریح/,
  /\bwho (is|was)\b/i, /\bwhat (is|are|was|were)\b/i,
  /\bwhere (is|are|was|were)\b/i, /\bwhen (is|was|did)\b/i,
  /\bwhy (is|are|was|do|does|did)\b/i,
  /\bhow (many|much|long|old|far|do|does|can)\b/i,
  /\bwho (wrote|invented|discovered|founded|created)\b/i,
  /\b(کتاب|کتابونه)\b/i,
];

export function isFactualQuestion(text: string): boolean {
  const q = text.trim();
  if (q.length < 3) return false;
  // Small talk that merely starts with a question word ("How are
  // you?") is conversational, never factual — the offline brain
  // answers it (the route checks the brain before this classifier).
  if (/^how are you\b/i.test(q) || /^(څنګه یې|څنګه یی|ته څنګه یې|ته څنګه یی)/.test(q)) {
    return false;
  }
  const words = topicWords(q);
  // A factual question needs at least one real content word besides
  // the question word itself ("what?" alone is not factual).
  if (words.length === 0) return false;
  if (FACTUAL_PATTERNS.some((re) => re.test(q))) return true;
  const first = q
    .replace(/^[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F]+/, "")
    .split(/\s+/)[0]
    ?.toLowerCase();
  if (first && QUESTION_WORDS.includes(first)) return true;
  // A "?" plus a question word anywhere ("Paris — what is it?").
  if (/[؟?]/.test(q)) {
    const lower = q.toLowerCase();
    if (QUESTION_WORDS.some((w) => lower.includes(w))) return true;
  }
  return false;
}

function isBookQuestion(question: string): boolean {
  return /book|کتاب/i.test(question);
}

async function duckDuckGo(
  question: string,
  lang: FreeWebLang,
  words: string[],
  phrase: string
): Promise<FreeWebAnswer | null> {
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
  // ROUND 4: every DuckDuckGo candidate must actually be about the
  // question's topic words — an unchecked abstract / related topic
  // is how an off-topic snippet (e.g. Cunard Line) leaked through.
  // When the question has a multi-word key phrase ("capital of
  // France"), the candidate must contain that phrase: the "Capital"
  // magazine shares the words "capital"+"France" but never says
  // "capital of France", so it is not an answer. With no phrase
  // (single-word question) the word match alone decides.
  const candidates: Array<{ text: string; source: string }> = [];
  const abstract = (data.AbstractText ?? "").trim();
  if (abstract) {
    candidates.push({
      text: abstract,
      source: (data.AbstractSource ?? "").trim() || "DuckDuckGo",
    });
  }
  const answer = (data.Answer ?? "").trim();
  if (answer) candidates.push({ text: answer, source: "DuckDuckGo" });
  const topics = data.RelatedTopics ?? [];
  for (const t of topics) {
    const text = (t.Text ?? "").trim();
    if (text.length > 20) candidates.push({ text, source: "DuckDuckGo" });
    const sub = t.Topics ?? [];
    for (const s of sub) {
      const st = (s.Text ?? "").trim();
      if (st.length > 20) candidates.push({ text: st, source: "DuckDuckGo" });
    }
  }
  const onTopic = candidates.filter((c) => matchesTopic(c.text, c.source, words));
  const withPhrase = onTopic.filter((c) => phraseIn(c.text, phrase));
  // Multi-word phrase: only a candidate containing the phrase counts.
  // Single-word question: the word match alone decides.
  const best = phrase.includes(" ") ? withPhrase[0] : onTopic[0];
  if (best) return compose(best.text, best.source, lang);
  return null;
}

async function wikipedia(
  question: string,
  lang: FreeWebLang,
  words: string[],
  phrase: string
): Promise<FreeWebAnswer | null> {
  const topic = deriveTopic(question);
  const wikiLang = WIKI_LANG[lang];
  const sourceName = SOURCE_NAME[lang].wiki;
  if (topic.length >= 2) {
    const title = encodeURIComponent(topic.replace(/\s+/g, "_"));
    const summary = (await fetchJson(
      `https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${title}`
    )) as { extract?: string; type?: string } | null;
    // ROUND 4: a summary only counts when it is about the question
    // itself — its extract must contain ALL of the question's
    // content words ("capital" AND "France"), and a disambiguation
    // page never counts. Otherwise fall through to search.
    if (
      summary &&
      summary.type !== "disambiguation" &&
      typeof summary.extract === "string" &&
      summary.extract.trim() &&
      snippetMatches(summary.extract, topic, words)
    ) {
      return compose(summary.extract.trim(), sourceName, lang);
    }
  }
  // Fallback: search API on the same language Wikipedia, then English.
  // Scan the first few hits and take the first whose title/snippet
  // actually contains every question word — the top hit is often about
  // a different subject that shares one word. (Match on the QUESTION's
  // words, not just the derived topic: for "capital of France" the
  // topic is "France", but the answer must say "capital" too.)
  // Search with the question's content words ("capital France") so
  // the Paris article outranks the France article.
  const searchText = words.length > 0 ? words.join(" ") : topic || question;
  for (const sub of [wikiLang, "en"]) {
    const data = (await fetchJson(
      `https://${sub}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchText
      )}&format=json&origin=*`
    )) as { query?: { search?: Array<{ snippet?: string; title?: string }> } } | null;
    const results = data?.query?.search ?? [];
    const matches = results
      .slice(0, 8)
      .map((hit) => ({ title: hit.title ?? "", snippet: hit.snippet ? stripHtml(hit.snippet) : "" }))
      .filter((m) => m.snippet.length > 20 && snippetMatches(m.snippet, m.title, words));
    // Rank the matches: a hit whose snippet actually states the
    // question's key phrase ("The capital of France has been Paris")
    // beats one that merely mentions the words ("Capital is a monthly
    // French magazine…"); then a hit whose FIRST sentence already
    // states the topic, then a short title (the article about the
    // thing itself, e.g. "Paris" over "Capital punishment in France").
    const scored = matches
      .map((m) => {
        const first = m.snippet.split(/[.!؟]/)[0] ?? "";
        const firstStatesTopic = words.every((w) => first.toLowerCase().includes(w.toLowerCase()));
        const titleWords = m.title.split(" ").filter(Boolean).length || 99;
        return {
          m,
          score: (phraseIn(m.snippet, phrase) ? -20 : 0) + (firstStatesTopic ? 0 : 10) + titleWords,
        };
      })
      .sort((a, b) => a.score - b.score);
    const best = scored[0]?.m;
    if (best) return compose(best.snippet, sourceName, lang);
  }
  return null;
}

async function googleBooks(
  question: string,
  lang: FreeWebLang,
  words: string[]
): Promise<FreeWebAnswer | null> {
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
  if (info.description) parts.push(stripHtml(info.description));
  const fact = parts.join(" — ");
  if (fact.length < 10) return null;
  // ROUND 4: the book must share at least one content word with the
  // question, or it is a random book, not an answer.
  if (words.length > 0) {
    const hay = fact.toLowerCase();
    if (!words.some((w) => hay.includes(w.toLowerCase()))) return null;
  }
  return compose(fact, SOURCE_NAME[lang].books, lang);
}

/**
 * Free web answer for a question. Tries DuckDuckGo, then Wikipedia,
 * and Google Books for book questions. Returns null when no source
 * has anything useful — the caller must never invent an answer.
 * Every candidate is relevance-checked against the question's
 * content words (see matchesTopic / snippetMatches).
 */
export async function getFreeWebAnswer(
  question: string,
  lang: FreeWebLang
): Promise<FreeWebAnswer | null> {
  const q = question.trim();
  if (q.length < 2) return null;
  const words = topicWords(q);
  const phrase = derivePhrase(q);
  if (isBookQuestion(q)) {
    return (
      (await googleBooks(q, lang, words)) ??
      (await duckDuckGo(q, lang, words, phrase)) ??
      (await wikipedia(q, lang, words, phrase))
    );
  }
  return (await duckDuckGo(q, lang, words, phrase)) ?? (await wikipedia(q, lang, words, phrase));
}
