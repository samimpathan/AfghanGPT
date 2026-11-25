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
 * explicitly rate-limited us (429/402) — otherwise busy=false.
 *
 * LIMITED, SAFE RETRY (2026-11-25): the anonymous tier allows ~1
 * image per 45s per IP, so a burst of requests hits 402 FREE_LIMIT
 * ("Retry after Ns") and the service is flaky under load (5xx /
 * dropped connections). One retry, once, is worth it — a user who
 * asked for one image should not fail just because the previous
 * image was made 20 seconds ago:
 * - 429/402: parse "Retry after Ns" from the error body (default
 *   15s, capped at 40s) and retry once after that wait.
 * - any other transient failure (5xx, bad bytes, network error):
 *   retry once after 3s.
 * - the retry only happens when the whole call still fits in a
 *   55s budget (the calling routes allow 60s); otherwise the
 *   failure is returned honestly. Never more than 2 attempts,
 *   never longer than ~55s, no extra cost — same free provider.
 */
export async function generateFreeImage(
  prompt: string,
  ratio = "1:1"
): Promise<FreeImageResult> {
  const started = Date.now();
  const { width, height } = pollinationsSize(ratio);
  const url = (seed: number) =>
    `${POLLINATIONS_URL}${encodeURIComponent(prompt)}` +
    `?width=${width}&height=${height}&seed=${seed}&nologo=true`;

  type Attempt =
    | { kind: "ok"; dataUrl: string }
    | { kind: "busy"; retryAfterSec: number }
    | { kind: "fail" };

  async function attempt(): Promise<Attempt> {
    const seed = Math.floor(Math.random() * 1_000_000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FREE_IMAGE_TIMEOUT_MS);
    try {
      const res = await fetch(url(seed), { signal: controller.signal });
      if (res.status === 429 || res.status === 402) {
        // The 402 body is JSON: {"error":{"message":"... Retry
        // after 38s, ..."}} — honour its wait when it parses.
        let retryAfterSec = 15;
        try {
          const body = await res.text();
          const m = /Retry after (\d+)s/i.exec(body);
          if (m) retryAfterSec = Math.min(Number(m[1]), 40);
        } catch {
          // ignore — default wait stands
        }
        return { kind: "busy", retryAfterSec };
      }
      if (!res.ok) return { kind: "fail" };
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) return { kind: "fail" };
      const buf = Buffer.from(await res.arrayBuffer());
      if (!isImageBytes(buf)) return { kind: "fail" };
      return { kind: "ok", dataUrl: `data:${mimeFor(buf)};base64,${buf.toString("base64")}` };
    } catch {
      return { kind: "fail" };
    } finally {
      clearTimeout(timeout);
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Room for one more attempt (~6s for a generation) inside 55s.
  // A 402's "Retry after Ns" is ~45s minus the time since the last
  // success, so a full wait + generation is ~50s — inside the
  // routes' 60s, but only just; the budget check keeps it honest.
  const fitsRetry = (waitMs: number) =>
    Date.now() - started + waitMs + 6_000 <= 55_000;

  const first = await attempt();
  if (first.kind === "ok") return { ok: true, dataUrl: first.dataUrl };
  if (first.kind === "busy") {
    const waitMs = first.retryAfterSec * 1_000;
    if (fitsRetry(waitMs)) {
      await sleep(waitMs);
      const second = await attempt();
      if (second.kind === "ok") return { ok: true, dataUrl: second.dataUrl };
      if (second.kind === "busy") return { ok: false, busy: true };
      return { ok: false, busy: false };
    }
    return { ok: false, busy: true };
  }
  // Transient failure: one quick retry after 3s.
  if (fitsRetry(3_000)) {
    await sleep(3_000);
    const second = await attempt();
    if (second.kind === "ok") return { ok: true, dataUrl: second.dataUrl };
    if (second.kind === "busy") return { ok: false, busy: true };
  }
  return { ok: false, busy: false };
}
