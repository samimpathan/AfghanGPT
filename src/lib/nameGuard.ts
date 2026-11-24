/**
 * Founder-name guard — the founder's name must ALWAYS display as
 * عبدالصمیم نیازی / Abdul Samim Niazai.
 *
 * ROOT CAUSE (2026-11-24): the system prompts only ever gave the
 * founder's name in Latin letters ("Abdul Samim Niazai"). When the
 * model answers in Pashto it transliterates "Samim" itself — and
 * sometimes writes سمیع (Sami) instead of صمیم (Samim), e.g.
 * "عبدالسمیع نیازي". The app's own code never contained that
 * spelling (0 matches in src/); it is model variance, so it is
 * fixed in TWO layers:
 *   1. the system prompt now states the exact Pashto spelling and
 *      forbids the misspelling (see founderPromptBlock + LIVE_SYSTEM);
 *   2. this guard deterministically corrects any misspelling that
 *      still slips through, in every AI chat reply, BEFORE the user
 *      sees it (text, voice and saved history all read the same
 *      corrected reply).
 *
 * The guard runs ONLY on assistant replies — never on the user's
 * own messages and never on file contents the user asked the AI
 * to write (a file could legitimately name someone else).
 */

// Longest pattern the guard must catch whole:
// "عبدالسمیع نیازی" (~15 chars) / "Abdul Samee Niazai" (19 chars).
// The streaming guard holds back this many chars so a misspelling
// split across two chunks is still caught.
export const NAME_GUARD_TAIL = 32;

const PS_NAME = "عبدالصمیم نیازی";
const EN_NAME = "Abdul Samim Niazai";

/**
 * Correct every known misspelling of the founder's name in `text`.
 * Idempotent: running it on already-correct text changes nothing.
 * - Pashto/Arabic script: عبدالسمیع / عبدالسميع / عبد السمیع /
 *   عبدالصمیع (wrong final letter) → عبدالصمیم نیازی. Each pattern
 *   consumes the OPTIONAL surname (نیاز[یي]) as well, so a misspelled
 *   first name followed by the surname is replaced as a whole and
 *   the surname is never duplicated; a misspelled first name on its
 *   own gains the surname. Plus نیازي → نیازی, plus a dedupe rule:
 *   "عبدالصمیم نیازی نیازی" (which a stream can produce when the
 *   real surname arrives after the eagerly added one) collapses to
 *   a single "عبدالصمیم نیازی".
 * - Latin: "Abdul Sami / Samie / Samee + Niazai/Niazi" → EN_NAME.
 * - Brand: "افغان GPT" / "Afghan GPT" → "AfghanGPT".
 * Bare "Abdul Sami" WITHOUT the surname is left alone — it could
 * be a different person the user asked about.
 */
export function normalizeFounderName(text: string): string {
  if (!text) return text;
  let out = text;
  // Pashto/Arabic script — wrong "Sami" forms (سمیع/سمیع with either
  // Yeh (ی U+06CC or ي U+064A), with or without a space after عبد,
  // wrong final ع/م). [یي] covers both Yeh forms. Each pattern also
  // consumes the optional surname (نیاز[یي]) so the whole name is
  // replaced at once — otherwise the surname would survive and be
  // duplicated ("...نیازی نیازی").
  out = out.replace(/عبد\s*السم[یي][عی](?:\s+نیاز[یي])?/g, PS_NAME);
  out = out.replace(/عبد\s*الصم[یي][عی](?:\s+نیاز[یي])?/g, PS_NAME);
  // The surname is always نیازی (Farsi Yeh), never نیازي (Arabic Yeh).
  out = out.replace(/نیازي/g, "نیازی");
  // Streaming safety: the two patterns above expand a bare misspelled
  // first name to the full name. In a stream the real surname may
  // still be in flight when that happens, so it arrives AFTER the
  // added one ("عبدالصمیم نیازی نیازی"). Collapse a doubled surname
  // back to one. (Runs after the نیازي → نیازی unification above,
  // so it also catches a second surname written with either Yeh.)
  out = out.replace(/عبدالصمیم نیازی(?:\s+نیاز[یي])+/g, PS_NAME);
  // Latin — only the full name (first + surname) is corrected.
  out = out.replace(/Abdul\s+Sam(?:i|ie|ee)\s+Niazai/gi, EN_NAME);
  out = out.replace(/Abdul\s+Sam(?:i|ie|ee)\s+Niazi/gi, EN_NAME);
  // Brand — "Afghan GPT" / "افغان GPT" (with a space) → "AfghanGPT".
  out = out.replace(/افغان\s+GPT/g, "AfghanGPT");
  out = out.replace(/Afghan\s+GPT/g, "AfghanGPT");
  return out;
}

/**
 * Stream-safe wrapper for an async text generator (e.g. the Gemini
 * reply stream). Holds back the last NAME_GUARD_TAIL chars of the
 * running text so a misspelling split across chunk boundaries is
 * still corrected, then flushes the tail (corrected) at the end.
 * Yields corrected chunks; the joined output equals
 * normalizeFounderName(full text).
 */
export async function* guardChatStream(
  gen: AsyncGenerator<string>
): AsyncGenerator<string> {
  let tail = "";
  for await (const chunk of gen) {
    const combined = tail + chunk;
    const corrected = normalizeFounderName(combined);
    if (corrected.length <= NAME_GUARD_TAIL) {
      tail = corrected;
      continue;
    }
    const emit = corrected.slice(0, corrected.length - NAME_GUARD_TAIL);
    tail = corrected.slice(corrected.length - NAME_GUARD_TAIL);
    if (emit) yield emit;
  }
  if (tail) yield tail;
}
