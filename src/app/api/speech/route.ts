import { NextRequest } from "next/server";
import { synthesizeSpeech } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/speech — read-aloud for languages the device has no
 * speechSynthesis voice for (Pashto/Dari on Chrome/Android).
 * Body: { text, lang }. Returns { audio } — a data URL.
 * 503 { error: "no-key" } when no Gemini key is configured;
 * 502 when the TTS model is unavailable for this key. */
export async function POST(req: NextRequest) {
  let body: { text?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const lang = body.lang === "fa" || body.lang === "en" ? body.lang : "ps";
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

  const audio = await synthesizeSpeech(clipped, lang, apiKey);
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
