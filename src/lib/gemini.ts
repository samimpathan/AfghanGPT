/**
 * lib/gemini.ts — Google Gemini API helper (server-side ONLY).
 * The API key is read from process.env.GEMINI_API_KEY (or GEMINIAPIKEY,
 * the spelling the key was saved under in Vercel) on the server.
 * It is NEVER exposed to the browser and NEVER hardcoded.
 */

import { founderPromptBlock } from "./founder";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  /** Optional attached photo as a data URL (data:<mime>;base64,...). */
  image?: string;
};

/**
 * Model chain for text chat. gemini-3-flash-preview is the primary model;
 * if it fails (503 high demand, 429, timeout, network error) we retry once
 * with gemini-flash-lite-latest (verified working for this key 2026-11-22
 * 17:08) before giving up. Known NOT to use for this key:
 * gemini-2.5-flash (404 "no longer available to new users"),
 * gemini-2.0-flash and gemini-2.5-flash-lite (404),
 * gemini-3.8-flash and gemini-flash-latest (503 high demand).
 */
const CHAT_MODELS = ["gemini-3-flash-preview", "gemini-flash-lite-latest"] as const;

/** ROUND 6 — first-attempt failure fix (2026-11-23, proven live).
 * The primary model was observed hanging for a full 60s (and 503ing)
 * while the fallback answered in ~1.5s — yet first attempts still
 * failed after ~90s with a dead-end error. Root cause: the old
 * 60s-per-model timeout let ONE hung model eat the whole Vercel 60s
 * function budget, so the function was killed (504) before the
 * fallback model — or the graceful offline fallback — could run.
 * Each model now gets at most FIRST_CHUNK_MS for its FIRST token;
 * the whole chain is bounded by the caller's deadline (the route
 * passes request start + 50s, leaving margin for cold start). Once
 * the first token arrives, the rest of the stream gets the remaining
 * budget instead (a full reply can take ~45s; cutting it at 20s
 * would truncate good answers). */
const FIRST_CHUNK_MS = 20000;
const DEFAULT_BUDGET_MS = 50000;

/** Absolute deadline (Date.now() ms) by which a Gemini call must
 * settle — first chunk, fallback model, everything. Callers that
 * know the request start (the /api/chat route) pass their own. */
export type GeminiOptions = { deadline?: number };

/** gemini-3-flash-preview is a thinking model: without a cap, a Pashto
 * reply spends ~13s thinking and dies on Vercel Hobby's 10s limit.
 * thinkingBudget 0 disables thinking (verified 2026-11-23: Pashto
 * total 12.9s → 4.91s, first text 2.19s). The fallback model
 * gemini-flash-lite-latest REJECTS thinkingConfig with HTTP 400, so
 * it is only sent for the thinking model — never for the fallback. */
function thinkingConfigFor(model: string) {
  return model === "gemini-3-flash-preview"
    ? { thinkingConfig: { thinkingBudget: 0 } }
    : {};
}
const TTS_MODEL = "gemini-2.5-flash-preview-tts";

function modelStreamUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
}

function modelUrl(model: string, action: "generateContent"): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`;
}

/** R3-F (2026-11-24): image model. gemini-nano-banana-2.1 is Google's
 * current GA image model ("primary high-efficiency workhorse"); the old
 * gemini-2.5-flash-image is deprecated (shutdown 2027-03-15). Same
 * :generateContent request shape (TEXT+IMAGE modalities) for both.
 * NOTE — tested 2026-11-24 against the real free-tier key via the
 * Muse Gemini connector: gemini-2.5-flash-image, gemini-3.1-flash-image,
 * gemini-3.1-flash-lite-image and gemini-nano-banana-2.1 ALL return
 * HTTP 429 "quota exceeded ... limit: 0" on the free tier, and
 * gemini-2.0-flash-preview-image-generation is 404 (retired). Google's
 * Gemini API pricing page lists the free tier as "Not available" for
 * every image model — image generation needs a billed key. So live
 * image generation stays honestly unavailable (route returns 502)
 * until billing is enabled; this switch only keeps the wiring on the
 * current model for that day. Do NOT present this as a live fix. */
const IMAGE_MODEL_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent";

const SYSTEM_PROMPT = `You are AfghanGPT ("د افغانانو مرستیال"), the free AI assistant built by Abdul Samim Niazai (Samim Pathan).

${founderPromptBlock()}

Answer in the user's language — Pashto by default, otherwise the language they write in. Use simple, clear explanations.
You are an expert in all technology — programming (HTML, CSS, JavaScript, Python, C++, Java), building websites and mobile apps, artificial intelligence, databases, networking, cybersecurity, hardware, cloud computing, and general tech — as well as teaching English and general knowledge.
Give complete, thorough answers — never cut an answer short; explain fully, with code examples when asked. Never claim to be Muse, ChatGPT, or Google. If the user asks for porn, adult or sexy content, do not generate it — reply only in Pashto: "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسي او نور — په خوښۍ به دې مرسته وکړم."`;

function toGeminiContents(messages: ChatMsg[]) {
  return messages.map((m) => {
    const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
      { text: m.content },
    ];
    // An attached photo travels as inline image data with the question.
    if (m.role === "user" && m.image) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(m.image);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });
}

/** Best-effort image generation with Gemini's image model.
 * Returns the image as a data URL, or null when the model is unavailable
 * for this key — callers must then say so honestly, never fake an image.
 * R3-F (2026-11-24): on the free-tier key every image model returns
 * 429 quota-exceeded (limit 0), so this currently returns null and the
 * /api/image route answers 502 model-unavailable. That is the honest
 * outcome until a billed key is configured. */
export async function generateImage(
  prompt: string,
  apiKey: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${IMAGE_MODEL_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: {
        content?: {
          parts?: { inlineData?: { mimeType?: string; data?: string } }[];
        };
      }[];
    };
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data);
    if (!img?.inlineData?.data) return null;
    const mime = img.inlineData.mimeType ?? "image/png";
    return `data:${mime};base64,${img.inlineData.data}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export type GeminiMode = "auto" | "fast" | "smart";

function modePrompt(mode: GeminiMode): string {
  if (mode === "fast") {
    return "\nKeep answers short and concise — a few lines at most, unless code is asked for.";
  }
  if (mode === "smart") {
    return "\nGive detailed, step-by-step answers with examples when useful.";
  }
  return "";
}

function modeTokens(mode: GeminiMode): number {
  // ROUND 5: answers must be UNLIMITED, not cut short. Auto/Smart get
  // a large budget so long answers finish; Fast stays smaller by
  // design (the user picked the short style there).
  if (mode === "fast") return 2048;
  if (mode === "smart") return 8192;
  return 4096;
}

/** Stream Gemini reply text chunk by chunk, with model fallback.
 * Tries CHAT_MODELS in order; a failed model (non-2xx, timeout, network
 * error) is retried with the next model. Throws only when every model
 * failed — the error message carries the last HTTP status, never the key.
 * A failure AFTER the first chunk was already yielded is also thrown, so
 * the caller can tell a mid-stream break from a total failure. */
export async function* streamGemini(
  messages: ChatMsg[],
  apiKey: string,
  mode: GeminiMode = "auto",
  systemOverride?: string,
  opts: GeminiOptions = {}
): AsyncGenerator<string> {
  const system =
    (systemOverride ? `${systemOverride}\n` : "") + SYSTEM_PROMPT + modePrompt(mode);
  const maxTokens = modeTokens(mode);
  const deadline = opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  let lastError: Error | null = null;

  for (const model of CHAT_MODELS) {
    // No budget left for another attempt — stop, don't start a call
    // that the function timeout would kill mid-flight.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    // First token only: a hung model must not eat the whole budget.
    let timer = setTimeout(
      () => controller.abort(),
      Math.min(remaining, FIRST_CHUNK_MS)
    );
    let res: Response;
    try {
      res = await fetch(`${modelStreamUrl(model)}&key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: toGeminiContents(messages),
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: maxTokens,
            ...thinkingConfigFor(model),
          },
        }),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      lastError = new Error(
        e instanceof Error && e.name === "AbortError"
          ? `Gemini request timed out (${model})`
          : `Could not reach Gemini (${model})`
      );
      continue; // try the next model
    }

    if (!res.ok) {
      clearTimeout(timer);
      const status = res.status;
      await res.text().catch(() => "");
      lastError = new Error(`Gemini error ${status} (${model})`);
      // 400/401/403 mean the key itself is bad — a different model will not help.
      if (status === 400 || status === 401 || status === 403) break;
      continue; // try the next model (e.g. 503/429 on the primary)
    }
    if (!res.body) {
      clearTimeout(timer);
      lastError = new Error(`Gemini returned an empty response (${model})`);
      continue;
    }

    // This model works — stream it. A stall BEFORE the first token is
    // a model failure like any other: try the next model. (The old
    // code had no catch here, so a stalled stream threw out of the
    // generator and the fallback model was never tried.) A stall
    // AFTER the first token is thrown — the caller already has a
    // partial reply and keeps it instead of starting over.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let yielded = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data);
            const parts = json?.candidates?.[0]?.content?.parts as
              | { text?: string }[]
              | undefined;
            for (const part of parts ?? []) {
              if (part.text) {
                if (!yielded) {
                  yielded = true;
                  // First token arrived: the reply is real. Give the
                  // rest of the stream the remaining budget instead
                  // of the short first-chunk timeout.
                  clearTimeout(timer);
                  timer = setTimeout(
                    () => controller.abort(),
                    Math.max(0, deadline - Date.now())
                  );
                }
                yield part.text;
              }
            }
          } catch {
            // Ignore one malformed SSE line and keep streaming.
          }
        }
      }
      if (!yielded) {
        // 200 with an empty stream is not a success — try the next
        // model instead of ending the chain here.
        lastError = new Error(`Gemini returned an empty response (${model})`);
        continue;
      }
      return; // success — do not try the next model
    } catch (e) {
      if (!yielded) {
        lastError = new Error(
          e instanceof Error && e.name === "AbortError"
            ? `Gemini request timed out (${model})`
            : `Gemini stream failed (${model})`
        );
        continue; // try the next model
      }
      throw e; // partial reply already yielded — keep it
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }

  throw lastError ?? new Error("Gemini request failed");
}

/** Non-streaming text reply (for the studios asking for strict JSON
 * specs, summaries, etc.). Same model fallback chain as streamGemini;
 * systemOverride is prepended to the system prompt when given. */
export async function generateText(
  messages: ChatMsg[],
  apiKey: string,
  mode: GeminiMode = "auto",
  systemOverride?: string,
  opts: GeminiOptions = {}
): Promise<string> {
  const system =
    (systemOverride ? `${systemOverride}\n` : "") + SYSTEM_PROMPT + modePrompt(mode);
  const maxTokens = modeTokens(mode);
  // Same budget as the stream: a hung model must not eat the whole
  // function budget (see FIRST_CHUNK_MS above).
  const deadline = opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  let lastError: Error | null = null;
  for (const model of CHAT_MODELS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(remaining, FIRST_CHUNK_MS)
    );
    try {
      const res = await fetch(
        `${modelUrl(model, "generateContent")}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: toGeminiContents(messages),
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: maxTokens,
              ...thinkingConfigFor(model),
            },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) {
        const status = res.status;
        lastError = new Error(`Gemini error ${status} (${model})`);
        if (status === 400 || status === 401 || status === 403) break;
        continue;
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      if (text) return text;
      lastError = new Error(`Gemini returned an empty response (${model})`);
    } catch (e) {
      lastError = new Error(
        e instanceof Error && e.name === "AbortError"
          ? `Gemini request timed out (${model})`
          : `Could not reach Gemini (${model})`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error("Gemini request failed");
}

/** Transcribe recorded speech with Gemini (audio as inlineData).
 * Returns the plain transcript in the language spoken, or null on failure. */
export async function transcribeAudio(
  audioBase64: string,
  mimeType: string,
  apiKey: string
): Promise<string | null> {
  const prompt =
    "Transcribe exactly what is said in this audio, in the language spoken. Return only the transcription, no explanation.";
  for (const model of CHAT_MODELS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(
        `${modelUrl(model, "generateContent")}?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: prompt },
                  { inlineData: { mimeType, data: audioBase64 } },
                ],
              },
            ],
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) continue;
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = json?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();
      return text || null;
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/** Text-to-speech with Gemini TTS. Returns audio as a data URL
 * (e.g. data:audio/wav;base64,...), or null when the model is unavailable
 * for this key — callers must then fall back honestly, never fake audio. */
export async function synthesizeSpeech(
  text: string,
  lang: string,
  apiKey: string
): Promise<string | null> {
  const voiceName =
    lang === "ps" || lang === "fa" ? "Kore" : lang === "en" ? "Puck" : "Kore";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      `${modelUrl(TTS_MODEL, "generateContent")}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName } },
            },
          },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      candidates?: {
        content?: {
          parts?: { inlineData?: { mimeType?: string; data?: string } }[];
        };
      }[];
    };
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const audio = parts.find((p) => p.inlineData?.data);
    if (!audio?.inlineData?.data) return null;
    const mime = audio.inlineData.mimeType ?? "audio/wav";
    return `data:${mime};base64,${audio.inlineData.data}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
