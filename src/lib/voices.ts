/**
 * lib/voices.ts — Gemini prebuilt voices (free, built-in).
 * Google's Live API ships 30 prebuilt voices; Settings offers a
 * curated 8 with distinct characters. The full list of 30 is the
 * server-side allow-list for /api/speech — the route never passes
 * raw user input to the API.
 * No voice here needs payment or an account. Voice cloning is
 * deliberately NOT supported (owner 2026-11-25: prebuilt voices
 * are enough; no voice sample is being collected).
 */

/** All 30 Gemini prebuilt Live voices (Google's published list). */
export const ALL_GEMINI_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Achird",
  "Achernar",
  "Pulcherrima",
  "Sulafat",
] as const;

export type GeminiVoice = (typeof ALL_GEMINI_VOICES)[number];

export function isGeminiVoice(v: string): v is GeminiVoice {
  return (ALL_GEMINI_VOICES as readonly string[]).includes(v);
}

/** Curated picker voices: id + the i18n key for the one-word
 * character label (Google's own descriptor for the voice). */
export const CURATED_VOICES: { id: GeminiVoice; descKey: string }[] = [
  { id: "Puck", descKey: "voiceDescUpbeat" },
  { id: "Kore", descKey: "voiceDescFirm" },
  { id: "Charon", descKey: "voiceDescInformative" },
  { id: "Fenrir", descKey: "voiceDescExcitable" },
  { id: "Aoede", descKey: "voiceDescBreezy" },
  { id: "Leda", descKey: "voiceDescYouthful" },
  { id: "Orus", descKey: "voiceDescFirm" },
  { id: "Zephyr", descKey: "voiceDescBright" },
];

/** Today's per-language default (what the app did before the
 * picker): Kore for Pashto/Dari, Puck for English. */
export function defaultVoiceForLang(lang: string): GeminiVoice {
  return lang === "en" ? "Puck" : "Kore";
}

/** Resolve a stored setting ("": automatic) to a real voice name.
 * Unknown stored values fall back to the language default — a
 * stored typo can never reach the API. */
export function resolveVoice(
  setting: string | undefined,
  lang: string
): GeminiVoice {
  if (setting && isGeminiVoice(setting)) return setting;
  return defaultVoiceForLang(lang);
}
