/** Free keyless image generation via Pollinations.ai (legacy endpoint).
 *
 * PROVEN 2026-11-25 by real calls from the VM (no docs-only trust):
 *   GET https://image.pollinations.ai/prompt/{prompt}?width=&height=&seed=&nologo=true
 *   → HTTP 200, Content-Type image/jpeg, real JPEG bytes (magic FF D8),
 *   512x512 in ~2s, 1024x576 in ~6s, Pashto prompt works, 3 rapid
 *   back-to-back calls all 200. No key, no account, no payment — for
 *   anyone, not just the founder.
 *
 * Honest limits (observed + documented):
 * - Anonymous tier is rate-limited (Pollinations docs: ~1 request per
 *   15s; a 402/429 means "try again in a moment"). Callers must surface
 *   that as a busy error, never fake an image.
 * - Images carry a small "pollinations.ai" watermark in the corner
 *   (seen on the real test images, even with nologo=true).
 * - The prompt travels in the URL path and the finished image is cached
 *   on Pollinations' public servers — so never put private or personal
 *   details in an image prompt. The privacy policy says this plainly.
 * - The legacy endpoint is the old, stable one; Pollinations' new
 *   platform (gen.pollinations.ai) is key-based and NOT used here.
 * - If this service is down, generation is honestly unavailable — the
 *   Gemini fallback below only runs when a Gemini key is configured,
 *   and on the free key every Gemini image model returns 429 quota 0.
 */

const POLLINATIONS_URL = "https://image.pollinations.ai/prompt/";

/** Free-tier generation is slow under load; 45s leaves headroom inside
 * the route's 60s maxDuration. A hung call must never hang the route. */
const FREE_IMAGE_TIMEOUT_MS = 45_000;

/** Max dimension (px) — keeps generations fast (~2-6s observed). */
const MAX_DIM = 1024;

export type FreeImageResult =
  | { ok: true; dataUrl: string }
  | { ok: false; busy: boolean };

/** Map a "W:H" ratio to pixel dimensions, longest side MAX_DIM. */
export function pollinationsSize(ratio: string): { width: number; height: number } {
  const m = /^(\d+)\s*:\s*(\d+)$/.exec(ratio.trim());
  const w = m ? Number(m[1]) : 1;
  const h = m ? Number(m[2]) : 1;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: MAX_DIM, height: MAX_DIM };
  }
  const scale = MAX_DIM / Math.max(w, h);
  return {
    width: Math.max(64, Math.round(w * scale)),
    height: Math.max(64, Math.round(h * scale)),
  };
}

function isImageBytes(buf: Buffer): boolean {
  if (buf.length < 1024) return false;
  // JPEG FF D8 FF, PNG 89 50 4E 47, WebP RIFF....WEBP, GIF 47 49 46.
  return (
    (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ||
    (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) ||
    (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) ||
    (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)
  );
}

function mimeFor(buf: Buffer): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49) return "image/webp";
  return "image/jpeg";
}

/** Generate one image with the free provider. Returns a data URL on
 * success; on failure { ok:false } with busy=true only when the service
 * explicitly rate-limited us (429/402) — otherwise busy=false. */
export async function generateFreeImage(
  prompt: string,
  ratio = "1:1"
): Promise<FreeImageResult> {
  const { width, height } = pollinationsSize(ratio);
  const seed = Math.floor(Math.random() * 1_000_000);
  const url =
    `${POLLINATIONS_URL}${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${seed}&nologo=true`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FREE_IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (res.status === 429 || res.status === 402) return { ok: false, busy: true };
    if (!res.ok) return { ok: false, busy: false };
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return { ok: false, busy: false };
    const buf = Buffer.from(await res.arrayBuffer());
    if (!isImageBytes(buf)) return { ok: false, busy: false };
    return { ok: true, dataUrl: `data:${mimeFor(buf)};base64,${buf.toString("base64")}` };
  } catch {
    return { ok: false, busy: false };
  } finally {
    clearTimeout(timeout);
  }
}
