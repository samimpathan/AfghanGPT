export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/live-token — mint a short-lived Gemini Live ephemeral
 * token server-side, so the browser NEVER sees the real API key.
 *
 * The key stays on the server (GEMINI_API_KEY || GEMINIAPIKEY).
 * Only the ephemeral token is returned to the client, which then
 * opens a WebSocket to the Gemini Live API with it on the
 * *Constrained* endpoint - the plain BidiGenerateContent endpoint
 * takes a raw API key and rejects ephemeral tokens:
 *   wss://generativelanguage.googleapis.com/ws/
 *     google.ai.generativelanguage.v1beta.GenerativeService
 *     .BidiGenerateContentConstrained?access_token=<token>
 * The token IS the `name` field of the auth_tokens response
 * ("auth_tokens/<hex>") - verified by live probe 2026-11-23 with
 * the real key: HTTP 200, body keys ["name"] only, no `token`
 * field. Google docs: "pass the value under token.name back to
 * your client".
 *
 * Token creation uses the v1beta auth_tokens endpoint ONLY, with
 * the fields at TOP LEVEL — no "config" wrapper:
 *   { "uses": 1, "expireTime": "<ISO>", "newSessionExpireTime": "<ISO>" }
 * Proven by live probe (2026-11-23): the top-level body returns
 * HTTP 200 { "name": "auth_tokens/<hex>" }; the "config" wrapper
 * returns HTTP 400 ("Unknown name \"config\" at 'auth_token'").
 * The old v1alpha/authTokens endpoint returns HTTP 404 (retired)
 * and is no longer tried.
 * The token is single-use, must be used within ~2 minutes, and expires
 * after 30 minutes at most.
 *
 * Responses:
 *   200 { token }                 — use it, then it is spent
 *   503 { error: "no-key" }       — no Gemini key configured
 *   502 { error: "live-unavailable", status?: <upstream HTTP> } —
 *     the Live API / ephemeral tokens are not available for this
 *     key. The client must NOT pretend a live call works; it falls
 *     back to push-to-talk voice mode and says so honestly.
 */
const TOKEN_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";

function expiryIso(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "no-key" }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  // Single-use token, 2 minutes to start the session, 30 min max life.
  // Fields at TOP LEVEL (no "config" wrapper) — proven by live probe.
  const body = JSON.stringify({
    uses: 1,
    expireTime: expiryIso(30),
    newSessionExpireTime: expiryIso(2),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  // Upstream status for the 502 body, so the client can tell a
  // bad request (400) from a key/permission problem (401/403) or
  // an outage (5xx) instead of one opaque failure.
  let lastStatus: number | null = null;
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body,
      signal: controller.signal,
    });
    lastStatus = res.status;
    if (res.ok) {
      const json = (await res.json()) as {
        token?: string;
        name?: string;
      };
      // The REST response carries ONLY `name` ("auth_tokens/<hex>")
      // and that IS the token (docs: "pass the value under
      // token.name back to your client"). `token` is kept only as
      // a fallback in case the shape ever gains that field.
      const token = json.token || json.name;
      if (token) {
        return new Response(JSON.stringify({ token }), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      }
    }
  } catch {
    // Fall through to the 502 below.
  } finally {
    clearTimeout(timeout);
  }

  console.error("Live ephemeral token unavailable for this key");
  return new Response(
    JSON.stringify({ error: "live-unavailable", status: lastStatus ?? undefined }),
    {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }
  );
}
