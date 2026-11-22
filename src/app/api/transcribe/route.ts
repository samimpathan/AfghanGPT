import { NextRequest } from "next/server";
import { transcribeAudio } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/transcribe — voice input for languages Chrome's
 * SpeechRecognition does not support (Pashto/Dari).
 * Body: { audioBase64, mimeType }. Returns { text }.
 * 503 { error: "no-key" } when no Gemini key is configured (offline);
 * 502 when Gemini could not transcribe the audio. */
export async function POST(req: NextRequest) {
  let body: { audioBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mimeType =
    typeof body.mimeType === "string" && body.mimeType ? body.mimeType : "audio/webm";
  if (!audioBase64) {
    return new Response("No audio", { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "no-key" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const text = await transcribeAudio(audioBase64, mimeType, apiKey);
  if (text === null) {
    return new Response(JSON.stringify({ error: "transcribe-failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return new Response(JSON.stringify({ text }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
