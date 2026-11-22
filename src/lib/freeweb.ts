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
 * app's main audience) unless it clearly looks like Dari or Arabic.
 * ROUND 5: \b does NOT work on Arabic-script words in JS (\b only
 * knows ASCII word characters), so the old /\b(ما|هل|…)\b/ tests
 * NEVER matched — every Arabic question fell through to Pashto and
 * got no answer. Word-list membership is used instead. "ما" is left
 * out of the Arabic list: it is also a Pashto word ("I"), while
 * "هي"/"هو"/"هذا"/"هذه"/"الذي" are distinctly Arabic. */
export function detectLang(text: string): FreeWebLang {
  if (/[ځڅډړږښګڼېۍ]/.test(text)) return "ps";
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) {
    const words = text.split(/\s+/).map((w) => w.replace(/[؟?!.،,؛:()«»"']/g, ""));
    const hasWord = (...ws: string[]) => ws.some((w) => words.includes(w));
    if (hasWord("است", "این", "چه", "کجا", "چرا", "چگونه", "چطور", "میشود", "می‌شود", "های", "بود", "خواهد")) return "fa";
    if (hasWord("هل", "أين", "اين", "هذا", "هذه", "كيف", "ماذا", "الذي", "التي", "كان", "يكون", "هي", "هو")) return "ar";
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
  // ROUND 5: answers must be FULL, not cut at ~600 chars. A Wikipedia
  // summary is 2–3 paragraphs — keep up to 2500 chars, still ending
  // at a complete sentence.
  s = truncateAtSentence(s, 2500);
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
  // ROUND 5: a leading greeting ("Hi, what is…?") is not part of the
  // topic — it used to poison the topic AND the key phrase, so "Hi,
  // what is the capital of France?" was answered with the "Capital"
  // magazine instead of Paris.
  q = q.replace(/^(hi|hello|salam|سلام)[,!\s]+/i, "");
  // "Which country is Paris in?" / "What country is Paris in?" — the
  // topic is the place itself (Paris); its summary states the country.
  const whichPlace = /^(?:which|what) (?:country|city) (?:is|was) (.+?)(?: in| located in)?$/i.exec(q);
  if (whichPlace) return whichPlace[1].trim();
  // Pashto: "پاریس د کوم هیواد پلازمېنه ده؟" — the topic is the place
  // itself (Paris). Dari: "پاریس پایتخت کدام کشور است؟" — same.
  // Both spellings of the Yeh are accepted (پلازمېنه/پلازمینه).
  const psWhichPlace = /^(.+?) د کوم (ه[یې]واد|ښار) /.exec(q);
  if (psWhichPlace) return psWhichPlace[1].trim();
  const faWhichPlace = /^(.+?) پایتخت کدام کشور/.exec(q);
  if (faWhichPlace) return faWhichPlace[1].trim();
  q = q.replace(/\s+(څه دی|څه ده|څه دي|چیست|کیست|ما هو|ما هي|what is it|is it)\s*$/i, "");
  const patterns: RegExp[] = [
    /^(what is|what are|what was|what did|what do|what does|who is|who was|who did|who wrote|who invented|who discovered|who founded|who created|who painted|who composed|where is|where are|where was|where did|when is|when was|when did|when do|when does|why is|why was|why did|why do|how is|how was|how did|how do|how does|how many|how much|define|tell me about|explain|meaning of|the capital of|capital of)\s+/i,
    /^(څه دی|څه ده|څه دي|څوک دی|څوک ده|څوک دي|چیرته دی|چیرته ده|کله دی|پایتخت|پلازمېنه)\s+/,
    /^(چیست|کیست|کجاست|پایتخت|تعریف)\s+/,
    /^(ما هو|ما هي|من هو|من هي|أين|عاصمة)\s+/,
  ];
  for (const p of patterns) q = q.replace(p, "");
  // ROUND 5: drop a leftover leading "the" ("Who invented the
  // telephone?" reduced to "the telephone" — there is no article
  // called "The Telephone", so the summary lookup always missed).
  q = q.replace(/^the\s+/i, "");
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
  // ROUND 5: "کوم" (which) and "څومره" (how many) are question words,
  // not content words — "پاریس د کوم هیواد پلازمېنه ده؟" is about
  // Paris, and the Paris snippet never says "کوم".
  "کوم", "څومره",
  "د", "په", "کې", "او", "له", "څخه", "ده", "دی", "دي", "که", "چی", "چه",
  "این", "است", "را", "به", "در", "از", "ما", "هو", "هي", "من", "في", "إلى", "عن", "على",
]);

// ROUND 5: question verbs are not content words for MATCHING — "who
// wrote Hamlet" is about Hamlet, and the Hamlet summary says "by
// William Shakespeare" without ever using the word "wrote". But they
// ARE kept for the Wikipedia SEARCH text: searching "invented
// telephone" finds "Invention of the telephone" / Bell, while
// searching just "telephone" returns only the device description.
const VERB_WORDS = new Set([
  "wrote", "written", "invented", "discovered", "founded", "created", "painted", "composed",
]);

function topicWords(topic: string, keepVerbs = false): string[] {
  // ROUND 5: Arabic punctuation (؟ ، ۔ ؛) sits INSIDE \u0600-\u06FF,
  // so the edge-strip regex below treats it as a letter — "ده؟" used
  // to survive as a content word, poisoning both the search text
  // ("فرانسې پلازمېنه ده؟") and the relevance match. Strip it first.
  return topic
    .split(" ")
    .map((w) =>
      w
        .replace(/[؟،۔؛«»"'“”]/g, "")
        .replace(/^[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F]+|[^a-zA-Z0-9\u0600-\u06FF\u0750-\u077F]+$/g, "")
    )
    .filter(
      (w) =>
        w.length > 2 &&
        !STOPWORDS.has(w.toLowerCase()) &&
        (keepVerbs || !VERB_WORDS.has(w.toLowerCase()))
    );
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
  // ROUND 5: strip a leading greeting (see deriveTopic).
  q = q.replace(/^(hi|hello|salam|سلام)[,!\s]+/i, "");
  q = q.replace(/\s+(څه دی|څه ده|څه دي|چیست|کیست|ما هو|ما هي|what is it|is it)\s*$/i, "");
  const patterns: RegExp[] = [
    /^(what is|what are|what was|what did|what do|what does|who is|who was|who did|who wrote|who invented|who discovered|who founded|who created|who painted|who composed|where is|where are|where was|where did|when is|when was|when did|when do|when does|why is|why was|why did|why do|how is|how was|how did|how do|how does|how many|how much|define|tell me about|explain|meaning of)\s+/i,
    /^(څه دی|څه ده|څه دي|څوک دی|څوک ده|څوک دي|چیرته دی|چیرته ده|کله دی)\s+/,
    /^(چیست|کیست|کجاست|تعریف)\s+/,
    /^(ما هو|ما هي|من هو|من هي|أين)\s+/,
  ];
  for (const p of patterns) q = q.replace(p, "");
  q = q.replace(/^the\s+/i, "");
  return q.trim();
}

/** ROUND 5 — Pashto Yeh folding for MATCHING only (never for fetch
 * URLs or article titles, where the exact spelling matters):
 * Pashto writes the same word with ی (U+06CC) or ې (U+06D0) —
 * "پاریس" vs "پاريس", "پلازمېنه" vs "پلازمینه", "هیواد" vs "هيواد"
 * — and different Wikipedia articles use different spellings, so a
 * plain substring match misses ("پاریس د کوم هیواد پلازمېنه ده؟"
 * once answered with Cambodia, whose snippet happened to spell the
 * words the question's way). Fold both to ی, plus Arabic-keyboard
 * ي/ك to ی/ک, before comparing. */
function foldPashto(s: string): string {
  return s.replace(/[ېۍ]/g, "ی").replace(/ي/g, "ی").replace(/ك/g, "ک");
}

function phraseIn(text: string, phrase: string): boolean {
  return phrase.length > 0 && foldPashto(text.toLowerCase()).includes(foldPashto(phrase));
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
  // ROUND 5: fold Pashto Yeh variants (see foldPashto) so "پاریس"
  // matches "پاريس" in an article that spells it the other way.
  const hay = foldPashto(`${title} ${text}`.toLowerCase());
  const found = words.filter((w) => hay.includes(foldPashto(w.toLowerCase()))).length;
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
  // ROUND 5: a "who" question is about a PERSON, not the topic's
  // definition — the "Penicillin" summary describes the drug and
  // never names Fleming, while a search for "discovered penicillin"
  // finds "Discovery of penicillin", whose summary names him. So
  // who-questions skip the direct summary and go straight to the
  // verb-aware search below.
  const isWhoQuestion = /^\s*(hi|hello|salam)?,?\s*who\b/i.test(question);
  if (!isWhoQuestion && topic.length >= 2) {
    const title = encodeURIComponent(topic.replace(/\s+/g, "_"));
    const summary = (await fetchJson(
      `https://${wikiLang}.wikipedia.org/api/rest_v1/page/summary/${title}`
    )) as { extract?: string; type?: string } | null;
    // ROUND 5: a summary only counts when it is about the TOPIC the
    // question was reduced to — its extract must contain the topic's
    // own words, and a disambiguation page never counts. Checking the
    // QUESTION's words was wrong: the Hamlet summary says "by William
    // Shakespeare" without the word "wrote", and the Paris summary
    // states the country without the word "country". Otherwise fall
    // through to search.
    const topicCheckWords = topicWords(topic);
    if (
      summary &&
      summary.type !== "disambiguation" &&
      typeof summary.extract === "string" &&
      summary.extract.trim() &&
      topicCheckWords.length > 0 &&
      matchesTopic(summary.extract, topic, topicCheckWords)
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
  // the Paris article outranks the France article — INCLUDING the
  // question verb ("invented telephone", not just "telephone"), so
  // a who-question finds the inventor's article, not just the
  // device's description.
  const searchWords = topicWords(question, true);
  const searchText = searchWords.length > 0 ? searchWords.join(" ") : topic || question;
  for (const sub of [wikiLang, "en"]) {
    const data = (await fetchJson(
      `https://${sub}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        searchText
      )}&format=json&origin=*`
    )) as { query?: { search?: Array<{ snippet?: string; title?: string }> } } | null;
    const results = data?.query?.search ?? [];
    // ROUND 5: search hits use the 2/3-word match (matchesTopic),
    // not the ALL-words match — "When did World War II end?" has
    // words [world, war, ii, end] and the right article's snippet
    // says "ended" without "end" as a separate word, so ALL-words
    // dropped every hit and the question got the honest fallback.
    // The direct-summary check above stays ALL-words (strict).
    const matches = results
      .slice(0, 8)
      .map((hit) => ({ title: hit.title ?? "", snippet: hit.snippet ? stripHtml(hit.snippet) : "" }))
      .filter((m) => m.snippet.length > 20 && matchesTopic(m.snippet, m.title, words));
    // Rank the matches: a hit whose snippet actually states the
    // question's key phrase ("The capital of France has been Paris")
    // beats one that merely mentions the words; then a hit whose
    // FIRST sentence already states the topic. Disambiguation
    // snippets ("Python may refer to…", "Look up Python…") are
    // pushed to the bottom — they answer nothing. Search order
    // (Wikipedia's own relevance) breaks remaining ties: the old
    // short-title bonus backfired ("Pythonidae" beat "Python
    // (programming language)" for "What is Python?").
    const scored = matches
      .map((m) => {
        const first = m.snippet.split(/[.!؟]/)[0] ?? "";
        // ROUND 5: fold Pashto Yeh variants here too (see foldPashto).
        const firstFolded = foldPashto(first.toLowerCase());
        const firstStatesTopic = words.every((w) => firstFolded.includes(foldPashto(w.toLowerCase())));
        const isDisambig = /may refer to|look up/i.test(m.snippet.slice(0, 80));
        // ROUND 5: Wikipedia's own order can put the wrong article
        // first ("President pro tempore…" outranks "President of the
        // United States" for "current president…"). Bonus when the
        // article's title is made ONLY of the question's words:
        // "President of the United States" is exactly the thing
        // asked about, while the pro-tempore title adds "pro /
        // tempore / senate". Exact-word match only — a substring
        // test would let "Pythonidae" pose as "Python" and beat the
        // programming-language article.
        const titleWordList = topicWords(m.title);
        const titleIsSubset =
          titleWordList.length > 0 &&
          titleWordList.every((tw) =>
            words.some((w) => foldPashto(tw.toLowerCase()) === foldPashto(w.toLowerCase()))
          );
        return {
          m,
          score:
            (phraseIn(m.snippet, phrase) ? -20 : 0) +
            (firstStatesTopic ? 0 : 10) +
            (isDisambig ? 100 : 0) +
            (titleIsSubset ? -10 : 0),
        };
      })
      .sort((a, b) => a.score - b.score);
    const best = scored[0]?.m;
    if (best) {
      // ROUND 5: a search snippet is only one short fragment — fetch
      // the FULL summary extract for the best article so the answer
      // is 2–3 complete paragraphs, not a clipped snippet. Fall back
      // to the snippet itself when the summary is missing or off-topic.
      // Relevance here is checked against the ARTICLE's title words
      // (the summary is about that article), not the question's
      // words — the World War II summary never says "end".
      const title = encodeURIComponent(best.title.replace(/\s+/g, "_"));
      const full = (await fetchJson(
        `https://${sub}.wikipedia.org/api/rest_v1/page/summary/${title}`
      )) as { extract?: string; type?: string } | null;
      const titleCheckWords = topicWords(best.title);
      if (
        full &&
        full.type !== "disambiguation" &&
        typeof full.extract === "string" &&
        full.extract.trim().length > 40 &&
        titleCheckWords.length > 0 &&
        matchesTopic(full.extract, best.title, titleCheckWords)
      ) {
        return compose(full.extract.trim(), sourceName, lang);
      }
      return compose(best.snippet, sourceName, lang);
    }
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
 * content words (see matchesTopic).
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
  // ROUND 5: a DuckDuckGo abstract is often only 1–2 sentences. When
  // it is short, also ask Wikipedia and return whichever answer is
  // fuller — the user asked for UNLIMITED information, not a snippet.
  // Exception: "who" questions — a DuckDuckGo abstract is usually a
  // DEFINITION ("Penicillins are a group of antibiotics…"), not the
  // person asked for, so Wikipedia's verb-aware search wins there.
  const isWho = /^\s*(hi|hello|salam)?,?\s*who\b/i.test(q);
  const ddg = await duckDuckGo(q, lang, words, phrase);
  if (ddg && ddg.text.length >= 400 && !isWho) return ddg;
  const wiki = await wikipedia(q, lang, words, phrase);
  if (wiki && ddg) return isWho || wiki.text.length >= ddg.text.length ? wiki : ddg;
  return ddg ?? wiki;
}
