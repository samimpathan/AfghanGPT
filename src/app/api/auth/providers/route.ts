import { NextResponse } from "next/server";
import { rateLimited, clientIp } from "@/lib/ratelimit";

/**
 * GET /api/auth/providers — R3-I pre-flight probe for the Google
 * OAuth provider (Finding F1).
 *
 * Problem it solves: supabase-js `signInWithOAuth` auto-navigates
 * the browser to Supabase's /auth/v1/authorize URL, so when the
 * Google provider is DISABLED the user lands on Supabase's raw
 * 400 JSON page ({"msg":"Unsupported provider: provider is not
 * enabled"}) and the wizard's friendly `googleNotConfigured`
 * error branch can never fire. This route probes that same
 * authorize endpoint SERVER-side (no browser CORS involved)
 * before the wizard navigates, so the app can show its own
 * friendly error instead.
 *
 * Response: { google: { enabled: boolean | null } }
 *   - false — CERTAIN: Supabase answered "provider is not
 *     enabled". The client must NOT navigate; it shows
 *     `googleNotConfigured`.
 *   - true  — the authorize endpoint redirected (3xx, i.e.
 *     towards Google). The provider answers as enabled.
 *   - null  — anything else (no Supabase URL configured, probe
 *     error/timeout, unexpected status/body). UNKNOWN. The
 *     client FAILS OPEN and runs the normal OAuth flow — the
 *     probe must never block a working sign-in because it could
 *     not tell. No "Google is ready" state is ever invented:
 *     `true` only means "the endpoint redirected", and the real
 *     sign-in still has to succeed on Google's page.
 *
 * Only a boolean (or null) is ever returned. No key, URL, or
 * Supabase response body is returned or logged. The probe sends
 * no credentials of its own; when the public anon key is
 * configured it is sent to Supabase exactly as the browser
 * client sends it on the real authorize request.
 * Result is cached 60 s in-process so a double-click does not
 * hammer Supabase; rate-limited to 10/min per IP.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 5_000;

let cache: { at: number; enabled: boolean | null } | null = null;

async function probeGoogle(): Promise<boolean | null> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  const authorize = `${base.replace(/\/$/, "")}/auth/v1/authorize?provider=google`;
  const headers: Record<string, string> = {};
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anon) {
    headers.apikey = anon;
    headers.Authorization = `Bearer ${anon}`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(authorize, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: ctrl.signal,
    });
    // Enabled: Supabase redirects the browser on to Google.
    if (res.status >= 300 && res.status < 400) return true;
    const text = await res.text().catch(() => "");
    // Disabled: the exact 400 the raw error page shows.
    if (/provider is not enabled/i.test(text)) return false;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  if (rateLimited(clientIp(req), 10, 60_000)) {
    // Fail open: an unknown probe result never blocks sign-in.
    return NextResponse.json({ google: { enabled: null } }, { status: 429 });
  }
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return NextResponse.json({ google: { enabled: cache.enabled } });
  }
  const enabled = await probeGoogle();
  cache = { at: now, enabled };
  return NextResponse.json({ google: { enabled } });
}
