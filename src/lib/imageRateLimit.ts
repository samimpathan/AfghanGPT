/**
 * lib/imageRateLimit.ts — per-IP quota for IMAGE generation only.
 *
 * POLICY (2026-11-25, owner order): 10 image requests per IP per
 * hour. One IP must not exhaust the shared free image quota (the
 * anonymous Pollinations tier allows ~1 image per 45s per shared
 * egress IP, and the app's server key has ZERO image quota), but
 * 10/hour is far above normal use — a real person asks for a few
 * images an hour, not dozens. This is an abuse brake, not a
 * billing limit: in-memory only, resets on cold start / redeploy,
 * per server instance on Vercel (approximate, not exact).
 *
 * SCOPE: image generation ONLY — POST /api/image and the chat
 * image branch. The text-chat path NEVER calls this module, so a
 * limited IP can still chat normally. The existing burst guards
 * (20/min on /api/image, 30/min on /api/chat, shared bucket in
 * lib/ratelimit.ts) stay as they are; this hourly quota is a
 * SEPARATE bucket so it cannot block text chat.
 *
 * DENIED requests return the existing busy message (429 image-busy
 * on /api/image; the IMAGE_GEN_BUSY text in chat) with a
 * Retry-After header — never a new error shape the clients do not
 * already handle.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 10; // 10 image requests per IP per hour

export const IMAGE_RATE_LIMIT = {
  /** Max image requests one IP may make in one window. */
  perIpPerHour: MAX_PER_WINDOW,
  /** Window length in seconds. */
  windowSeconds: WINDOW_MS / 1000,
} as const;

type ImageLimitState = {
  buckets: Map<string, { count: number; windowStart: number }>;
  denied: number;
};

/** SINGLETON ON globalThis (2026-11-25): same webpack chunk
 * duplication as lib/freeImage.ts — this module is bundled once per
 * route chunk, so a plain module-level Map would give each route its
 * own quota bucket and its own denial count. All chunks run in ONE
 * Node process under `next start`, so globalThis is the one place
 * they truly share. (On Vercel each serverless instance gets its
 * own — approximate, not exact.) */
const limitState: ImageLimitState = (
  globalThis as unknown as { __afghangptImageLimit?: ImageLimitState }
).__afghangptImageLimit ??= { buckets: new Map(), denied: 0 };

const buckets = limitState.buckets;

export function checkImageRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets (for Retry-After). */
  resetAfterSec: number;
} {
  const now = Date.now();
  // Prune expired buckets so the map stays bounded by the number
  // of IPs active in the current hour. (forEach: the project's TS
  // target does not allow for...of over a Map.)
  buckets.forEach((b, key) => {
    if (now - b.windowStart >= WINDOW_MS) buckets.delete(key);
  });
  const entry = buckets.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_PER_WINDOW - 1, resetAfterSec: WINDOW_MS / 1000 };
  }
  if (entry.count >= MAX_PER_WINDOW) {
    limitState.denied++;
    return {
      allowed: false,
      remaining: 0,
      resetAfterSec: Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000),
    };
  }
  entry.count++;
  return {
    allowed: true,
    remaining: MAX_PER_WINDOW - entry.count,
    resetAfterSec: Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000),
  };
}

/** How many image requests the hourly quota has denied (all IPs). */
export function getImageRateLimitStats(): { denied: number } {
  return { denied: limitState.denied };
}
