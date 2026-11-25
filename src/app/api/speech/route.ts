import { NextRequest } from "next/server";
import { synthesizeSpeech } from "@/lib/gemini";
import { isGeminiVoice } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/speech — read-aloud for languages the device has no
 * speechSynthesis voice for (Pashto/Dari on Chrome/Android).
 * Body: { text, lang, voice? }. `voice` is an optional Gemini
 * prebuilt voice name from Settings; anything not on the allow-list
 * is ignored (never passed raw to the API). Returns { audio } — a
 * data URL. 503 { error: "no-key" } when no Gemini key is configured;
 * 502 when the TTS model is unavailable for this key. */
export async function POST(req: NextRequest) {
  let body: { text?: string; lang?: string; voice?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const lang = body.lang === "fa" || body.lang === "en" ? body.lang : "ps";
  const voice =
    typeof body.voice === "string" && isGeminiVoice(body.voice)
      ? body.voice
      : undefined;
  if (!text) {
    return new Response("No text", { status: 400 });
  }
  // TTS audio is long; cap it so one reply cannot hang the request.
  const clipped = text.slice(0, 2000);

  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "no-key" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const audio = await synthesizeSpeech(clipped, lang, apiKey, voice);
  if (audio === null) {
    return new Response(JSON.stringify({ error: "tts-unavailable" }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify({ audio }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
