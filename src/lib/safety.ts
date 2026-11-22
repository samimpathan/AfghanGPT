/**
 * Safety — adult / porn / sexy content is banned in Samim AI.
 * Rule set by Samim (2026-11-22): if anyone asks for porn, adult or sexy
 * content, reply "دا محتوا نه لرو" (we do not have this content).
 * Every other kind of question is answered normally.
 */

// English category words (matched on word boundaries so "sex" does not
// fire inside unrelated words) + Pashto transliterations.
const BANNED_PATTERNS = [
  /\bporn\b/i,
  /\bpornography\b/i,
  /\bpornhub\b/i,
  /\bxxx\b/i,
  /\bsex\b/i,
  /\bsexy\b/i,
  /\badult\b/i,
  /\bnude\b/i,
  /\bnaked\b/i,
  /\berotic\b/i,
  /پورن/,
  /سکسی/,
  /اډلټ/,
  /فحش/,
];

export const ADULT_REFUSAL_PS =
  "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسی او نور — په خوښۍ به دې مرسته وکړم.";

export function isAdultRequest(text: string): boolean {
  return BANNED_PATTERNS.some((re) => re.test(text));
}
