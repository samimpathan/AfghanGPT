import { NextRequest } from "next/server";
import { generateImage } from "@/lib/gemini";
import { isAdultRequest } from "@/lib/safety";
import { rateLimited, clientIp } from "@/lib/ratelimit";
import { checkImageRateLimit } from "@/lib/imageRateLimit";
import { isFounderRequest } from "@/lib/founderAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Free generation can take ~2-6s per image (up to 45s on a slow day),
 * so the route needs more than the 10s Hobby default. */
export const maxDuration = 60;

/** POST /api/image — text-to-image, FOUNDER-ONLY (user order
 * 2026-11-25). Only the founder, logged in with his account
 * (samimpatan8@gmail.com), may generate images; everyone else gets
 * HTTP 403 { error: "founder_only" } and no image is generated.
 * The caller's Supabase JWT is verified server-side (see
 * lib/founderAuth.ts) — the client sends its session access token
 * as `Authorization: Bearer <token>`. A guest sends no token and
 * is refused. Body: { prompt, ratio? }. Returns { image } (data
 * URL) or an honest error — never a fake image. No API key is
 * needed from anyone: the free Pollinations.ai provider runs first
 * (no key, no account, no payment); Gemini runs only as a fallback
 * when a server key is configured. 429 image-busy when the free
 * service rate-limits us; 502 when no provider could make an image. */
export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req), 20, 60_000)) {
    return new Response(JSON.stringify({ error: "rate-limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Founder gate, before any validation or quota: a non-founder
  // spends no quota and reaches no provider. The founder's own
  // flow below is unchanged.
  if (!(await isFounderRequest(req))) {
    return new Response(JSON.stringify({ error: "founder_only" }), {
      status: 403,
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
  // Per-IP image quota (10/hour, lib/imageRateLimit.ts): one IP must
  // not exhaust the shared free image quota. Denied requests get the
  // SAME busy response as a provider rate-limit (429 image-busy) so
  // the Studio shows its existing "try again in a moment" message.
  // Only genuine generation attempts consume quota — empty prompts
  // and refusals above return before this check.
  const imgLimit = checkImageRateLimit(clientIp(req));
  if (!imgLimit.allowed) {
    return new Response(JSON.stringify({ error: "image-busy" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(imgLimit.resetAfterSec),
      },
    });
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
