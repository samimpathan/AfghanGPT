import { NextRequest } from "next/server";
import { generateImage } from "@/lib/gemini";
import { isAdultRequest } from "@/lib/safety";
import { rateLimited, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Free generation can take ~2-6s per image (up to 45s on a slow day),
 * so the route needs more than the 10s Hobby default. */
export const maxDuration = 60;

/** POST /api/image — text-to-image (best-effort, FREE for everyone).
 * Body: { prompt, ratio? }. Returns { image } (data URL) or an
 * honest error — never a fake image. No API key is needed from anyone:
 * the free Pollinations.ai provider runs first (no key, no account,
 * no payment); Gemini runs only as a fallback when a server key is
 * configured. 429 image-busy when the free service rate-limits us;
 * 502 when no provider could make an image. */
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
  // No key gate: the free provider needs no key from anyone. The
  // Gemini key (server env only) is used solely as a fallback.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY || null;
  const ratio = String(body.ratio ?? "1:1");
  const fullPrompt = `${prompt} (aspect ratio ${ratio})`;
  const { image, busy } = await generateImage(fullPrompt, apiKey, ratio);
  if (image) {
    return new Response(JSON.stringify({ image }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (busy) {
    return new Response(JSON.stringify({ error: "image-busy" }), { status: 429 });
  }
  return new Response(JSON.stringify({ error: "model-unavailable" }), { status: 502 });
}
