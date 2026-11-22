import { NextRequest } from "next/server";
import { generateImage } from "@/lib/gemini";
import { isAdultRequest } from "@/lib/safety";
import { rateLimited, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/image — text-to-image (best-effort).
 * Body: { prompt, ratio? }. Returns { image } (data URL) or an
 * honest error — never a fake image. 503 no-key when no Gemini
 * key is configured; 502 when the image model is unavailable
 * for this key. */
export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req), 20, 60_000)) {
    return new Response(JSON.stringify({ error: "rate-limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  let body: { prompt?: string; ratio?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad-json" }), { status: 400 });
  }
  const prompt = String(body.prompt ?? "").trim().slice(0, 1000);
  if (!prompt) {
    return new Response(JSON.stringify({ error: "empty-prompt" }), { status: 400 });
  }
  if (isAdultRequest(prompt)) {
    return new Response(JSON.stringify({ error: "refused" }), { status: 400 });
  }
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "no-key" }), { status: 503 });
  }
  const ratio = String(body.ratio ?? "1:1");
  const fullPrompt = `${prompt} (aspect ratio ${ratio})`;
  const image = await generateImage(fullPrompt, apiKey);
  if (!image) {
    return new Response(JSON.stringify({ error: "model-unavailable" }), { status: 502 });
  }
  return new Response(JSON.stringify({ image }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
