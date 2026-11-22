/**
 * lib/ratelimit.ts — simple in-memory per-IP rate limiting for API
 * routes. This is one VM process; Vercel serverless would reset it
 * per instance, so it is a basic abuse brake, not a billing limit.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(
  ip: string,
  limit = 30,
  windowMs = 60_000
): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
