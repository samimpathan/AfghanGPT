import { NextRequest } from "next/server";
import { rateLimited, clientIp } from "@/lib/ratelimit";

/**
 * POST /api/providers — forward a chat request to a user-configured
 * provider (OpenAI, Claude, DeepSeek, Grok, Qwen, OpenRouter,
 * Hugging Face). The user's key arrives per request in the body
 * (from Settings, stored ONLY in the user's browser localStorage);
 * it is NEVER persisted, NEVER logged, and NEVER sent anywhere
 * except that provider's own API.
 *
 * GET is not used for tests: keys must never travel in a URL
 * (URLs can be logged). The health test is a POST with
 * { provider, key, test: true } — a tiny real call ("Say OK")
 * that reports { ok: true } or { ok: false, error } honestly.
 * No key is ever logged.
 *
 * Gemini is NOT handled here — it has its own server key and its
 * own route (/api/chat). If the chosen provider fails, the chat UI
 * falls back to Gemini and says so.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProviderId =
  | "openai"
  | "anthropic"
  | "deepseek"
  | "grok"
  | "qwen"
  | "openrouter"
  | "huggingface";

type Msg = { role: "user" | "assistant"; content: string };

const OPENAI_COMPAT: Record<string, { baseUrl: string; defaultModel: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat" },
  grok: { baseUrl: "https://api.x.ai/v1", defaultModel: "grok-3-mini" },
  qwen: { baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", defaultModel: "qwen-plus" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", defaultModel: "meta-llama/llama-3.1-8b-instruct:free" },
};

const ANTHROPIC_MODEL = "claude-3-5-haiku-latest";
const HF_MODEL = "HuggingFaceH4/zephyr-7b-beta";

function cleanMessages(raw: unknown): Msg[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is Msg =>
        !!m &&
        typeof m === "object" &&
        ((m as Msg).role === "user" || (m as Msg).role === "assistant") &&
        typeof (m as Msg).content === "string"
    )
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 60_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** Forward to one provider. Returns { text } or throws an Error
 * whose message is safe to show the user (status only, never the key). */
async function forward(
  provider: ProviderId,
  key: string,
  messages: Msg[],
  model: string,
  system: string
): Promise<string> {
  if (provider === "anthropic") {
    const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || ANTHROPIC_MODEL,
        max_tokens: 2048,
        ...(system ? { system } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
    const json = (await res.json()) as {
      content?: { type?: string; text?: string }[];
    };
    const text = (json.content ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("Anthropic returned an empty reply");
    return text;
  }

  if (provider === "huggingface") {
    const prompt = messages
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");
    const res = await fetchWithTimeout(
      `https://api-inference.huggingface.co/models/${encodeURIComponent(model || HF_MODEL)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ inputs: `${system ? system + "\n" : ""}${prompt}\nAssistant:` }),
      }
    );
    if (!res.ok) throw new Error(`Hugging Face error ${res.status}`);
    const json = (await res.json()) as { generated_text?: string }[] | { error?: string };
    if (!Array.isArray(json)) throw new Error("Hugging Face returned an unexpected reply");
    let text = (json[0]?.generated_text ?? "").trim();
    // The model echoes the prompt — strip everything up to the last "Assistant:".
    const marker = text.lastIndexOf("Assistant:");
    if (marker >= 0) text = text.slice(marker + "Assistant:".length).trim();
    if (!text) throw new Error("Hugging Face returned an empty reply");
    return text;
  }

  const cfg = OPENAI_COMPAT[provider];
  if (!cfg) throw new Error("Unknown provider");
  const res = await fetchWithTimeout(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || cfg.defaultModel,
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...messages,
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) throw new Error(`${provider} error ${res.status}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = (json.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error(`${provider} returned an empty reply`);
  return text;
}

export async function POST(req: NextRequest) {
  if (rateLimited(clientIp(req), 30, 60_000)) {
    return new Response(JSON.stringify({ error: "rate-limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  let body: { provider?: string; key?: string; messages?: unknown; model?: string; system?: string; test?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad-json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provider = body.provider as ProviderId | undefined;
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const messages = cleanMessages(body.messages);
  const model = typeof body.model === "string" ? body.model.slice(0, 200) : "";
  const system = typeof body.system === "string" ? body.system.slice(0, 4000) : "";
  const isTest = body.test === true;
  if (
    !provider ||
    !["openai", "anthropic", "deepseek", "grok", "qwen", "openrouter", "huggingface"].includes(provider) ||
    !key ||
    key.length > 500 ||
    (!isTest && messages.length === 0)
  ) {
    return new Response(JSON.stringify({ error: "bad-request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    // Health test (Settings → Test): a tiny real call ("Say OK").
    if (isTest) {
      await forward(provider, key, [{ role: "user", content: "Say OK" }], "", "");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    const text = await forward(provider, key, messages, model, system);
    return new Response(JSON.stringify({ text, provider }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (e) {
    // Log provider + status only — never the key.
    console.error("Provider failed:", provider, e instanceof Error ? e.message : "unknown");
    return new Response(JSON.stringify({ error: "provider-failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
