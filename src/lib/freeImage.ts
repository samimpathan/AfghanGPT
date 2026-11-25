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

import { IMAGE_RATE_LIMIT, getImageRateLimitStats } from "./imageRateLimit";

/** IMAGE MONITORING (2026-11-25, owner rule 7): in-memory counters
 * for image generation — attempts, successes, rate-limited (busy)
 * events, failures, and the last error kind. Exposed as the
 * `images` field on GET /api/status for the admin dashboard. No
 * persistence, no user data (counts only, never prompts), no new
 * dependency. In-memory only: counters reset on cold start /
 * redeploy, and on Vercel each server instance counts separately —
 * treat the numbers as approximate, not exact billing.
 *
 * TWO LEVELS (2026-11-25, owner order 09:56):
 * - REQUEST level (attempts/successes/busy/failures): one count per
 *   user-facing image request, recorded in gemini.ts generateImage
 *   (the single entry point for Chat + Studio).
 * - PROVIDER level (providers.*): one count per provider ATTEMPT —
 *   a request can count against two providers when the free path
 *   fails and Gemini is tried. "none" counts requests no provider
 *   served (its success is always 0); lastProvider is the provider
 *   that served the last image, or "none" when the last request
 *   produced no image. */
export type ImageProvider = "pollinations" | "gemini" | "none";
export type ImageOutcome = "success" | "busy" | "fail";

type ProviderCounts = { success: number; busy: number; fail: number };
const emptyProviderCounts = (): ProviderCounts => ({ success: 0, busy: 0, fail: 0 });

type ImageStatsState = {
  attempts: number;
  successes: number;
  busy: number;
  failures: number;
  /** "rate-limited" | "failed" | null (null = the last call worked). */
  lastError: string | null;
  lastAttemptAt: number | null;
  lastProvider: ImageProvider | null;
  providers: Record<ImageProvider, ProviderCounts>;
  startedAt: number;
};

/** SINGLETON ON globalThis (2026-11-25): webpack bundles this module
 * once per route chunk in the production build (the /api/status chunk
 * inlines its own copy while /api/image + /api/chat share another),
 * so a plain module-level object would count per chunk and /api/status
 * would always read zeros. All chunks run in ONE Node process under
 * `next start`, so globalThis is the one place they truly share.
 * (On Vercel each serverless instance gets its own — same documented
 * "approximate, not exact" limit as before.) */
const imageStats: ImageStatsState = (
  globalThis as unknown as { __afghangptImageStats?: ImageStatsState }
).__afghangptImageStats ??= {
  attempts: 0,
  successes: 0,
  busy: 0,
  failures: 0,
  lastError: null,
  lastAttemptAt: null,
  lastProvider: null,
  providers: {
    pollinations: emptyProviderCounts(),
    gemini: emptyProviderCounts(),
    none: emptyProviderCounts(),
  },
  startedAt: Date.now(),
};

/** Record one provider's attempt outcome (Pollinations inside
 * generateFreeImage; Gemini inside gemini.ts generateImage). */
export function recordProviderAttempt(provider: Exclude<ImageProvider, "none">, outcome: ImageOutcome): void {
  imageStats.providers[provider][outcome === "success" ? "success" : outcome === "busy" ? "busy" : "fail"]++;
}

/** Record one user-facing image request: the request-level totals
 * plus which provider served it (or "none" when no provider did). */
export function recordImageRequest(provider: ImageProvider, outcome: ImageOutcome): void {
  imageStats.attempts++;
  imageStats.lastAttemptAt = Date.now();
  imageStats.lastProvider = provider;
  if (outcome === "success") {
    imageStats.successes++;
    imageStats.lastError = null;
  } else if (outcome === "busy") {
    imageStats.busy++;
    imageStats.lastError = "rate-limited";
  } else {
    imageStats.failures++;
    imageStats.lastError = "failed";
  }
  if (provider === "none") {
    if (outcome === "busy") imageStats.providers.none.busy++;
    else if (outcome === "fail") imageStats.providers.none.fail++;
  }
}

export function getImageStats(): {
  attempts: number;
  successes: number;
  busy: number;
  failures: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  lastProvider: ImageProvider | null;
  providers: Record<ImageProvider, ProviderCounts>;
  rateLimit: { perIpPerHour: number; windowSeconds: number; denied: number };
  uptimeSeconds: number;
  /** The honest free-tier limit — the app must never claim
   * unlimited free images anywhere. */
  freeLimit: string;
} {
  return {
    attempts: imageStats.attempts,
    successes: imageStats.successes,
    busy: imageStats.busy,
    failures: imageStats.failures,
    lastError: imageStats.lastError,
    lastAttemptAt: imageStats.lastAttemptAt
      ? new Date(imageStats.lastAttemptAt).toISOString()
      : null,
    lastProvider: imageStats.lastProvider,
    providers: {
      pollinations: { ...imageStats.providers.pollinations },
      gemini: { ...imageStats.providers.gemini },
      none: { ...imageStats.providers.none },
    },
    rateLimit: {
      perIpPerHour: IMAGE_RATE_LIMIT.perIpPerHour,
      windowSeconds: IMAGE_RATE_LIMIT.windowSeconds,
      denied: getImageRateLimitStats().denied,
    },
    uptimeSeconds: Math.floor((Date.now() - imageStats.startedAt) / 1000),
    freeLimit: "1 image per 45s per IP — anonymous Pollinations tier; NOT unlimited",
  };
}

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
 * Records the Pollinations provider attempt (see recordProviderAttempt);
 * the REQUEST-level totals are recorded by gemini.ts generateImage,
 * the single entry point for Chat + Studio. */
export async function generateFreeImage(
  prompt: string,
  ratio = "1:1",
  budgetMs = 55_000
): Promise<FreeImageResult> {
  const res = await runGenerateFreeImage(prompt, ratio, budgetMs);
  recordProviderAttempt("pollinations", res.ok ? "success" : res.busy ? "busy" : "fail");
  return res;
}

/** The actual generation + retry, without counting (the wrapper
 * above counts once per call).
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
async function runGenerateFreeImage(
  prompt: string,
  ratio = "1:1",
  budgetMs = 55_000
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
  // Room for one more attempt (~6s for a generation) inside the
  // budget (55s by default; generateImage shrinks it by the time
  // the prompt rewrite took, so the whole call fits the routes'
  // 60s limit). A 402's "Retry after Ns" is ~45s minus the time
  // since the last success, so a full wait + generation is ~50s —
  // inside the routes' 60s, but only just; the budget check keeps
  // it honest.
  const fitsRetry = (waitMs: number) =>
    Date.now() - started + waitMs + 6_000 <= budgetMs;

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
