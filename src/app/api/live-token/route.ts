export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/live-token — mint a short-lived Gemini Live ephemeral
 * token server-side, so the browser NEVER sees the real API key.
 *
 * The key stays on the server (GEMINI_API_KEY || GEMINIAPIKEY).
 * Only the ephemeral token is returned to the client, which then
 * opens a WebSocket to the Gemini Live API with it:
 *   wss://generativelanguage.googleapis.com/ws/
 *     google.ai.generativelanguage.v1beta.GenerativeService
 *     .BidiGenerateContentConstrained?access_token=<token>
 *
 * Token creation uses the v1alpha authTokens endpoint (the
 * v1beta spelling auth_tokens is tried as a fallback). The token
 * is single-use, must be used within ~2 minutes, and expires
 * after 30 minutes at most.
 *
 * Responses:
 *   200 { token }                 — use it, then it is spent
 *   503 { error: "no-key" }       — no Gemini key configured
 *   502 { error: "live-unavailable" } — the Live API / ephemeral
 *     tokens are not available for this key. The client must NOT
 *     pretend a live call works; it falls back to push-to-talk
 *     voice mode and says so honestly.
 */
const TOKEN_ENDPOINTS = [
  "https://generativelanguage.googleapis.com/v1alpha/authTokens",
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
];

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
  const body = JSON.stringify({
    config: {
      uses: 1,
      expireTime: expiryIso(30),
      newSessionExpireTime: expiryIso(2),
    },
  });

  for (const url of TOKEN_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body,
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        token?: string;
        name?: string;
      };
      // The REST response carries the token value in `token`;
      // some SDK shapes expose the resource name instead, which
      // the client SDK accepts as the token ("auth_tokens/...").
      const token = json.token || json.name;
      if (!token) continue;
      return new Response(JSON.stringify({ token }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  console.error("Live ephemeral token unavailable for this key");
  return new Response(JSON.stringify({ error: "live-unavailable" }), {
    status: 502,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
