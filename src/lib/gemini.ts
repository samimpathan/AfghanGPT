/**
 * lib/gemini.ts — Google Gemini API helper (server-side ONLY).
 * The API key is read from process.env.GEMINI_API_KEY (or GEMINIAPIKEY,
 * the spelling the key was saved under in Vercel) on the server.
 * It is NEVER exposed to the browser and NEVER hardcoded.
 */

import { founderPromptBlock } from "./founder";
import { generateFreeImage, recordProviderAttempt, recordImageRequest } from "./freeImage";
import { isGeminiVoice } from "./voices";

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  /** Optional attached photo as a data URL (data:<mime>;base64,...). */
  image?: string;
};

/**
 * Model chain for text chat. Order is chosen per request by
 * chatModelOrder() (founder order 2026-11-25 20:42): the FAST model
 * (gemini-flash-lite-latest) answers first by default — it answered a
 * Pashto greeting in 0.9s vs 2.4s for the thinking model, measured the
 * same day — and gemini-3-flash-preview stays as the fallback/second
 * model. Smart mode and complex questions (see isComplexQuestion)
 * still put the thinking model first, so accuracy is kept where it
 * matters. generateText/transcribeAudio (studios, transcription)
 * keep the old order [preview, lite] on purpose — strict JSON and
 * transcription need the stronger model first.
 * Known NOT to use for this key: gemini-2.5-flash (404 "no longer
 * available to new users"), gemini-2.0-flash and gemini-2.5-flash-lite
 * (404), gemini-3.8-flash and gemini-flash-latest (503 high demand).
 */
const PREVIEW_MODEL = "gemini-3-flash-preview";
const LITE_MODEL = "gemini-flash-lite-latest";
const CHAT_MODELS = [PREVIEW_MODEL, LITE_MODEL] as const;

/** First-chunk deadline PER MODEL (founder order 2026-11-25 20:42):
 * the fast model answers in ~1s, so if it has no first token in 8s
 * it is hung — fail over instead of waiting the old 20s. The
 * thinking model needs longer (it reasons before its first word),
 * so it keeps 20s. */
function firstChunkMsFor(model: string): number {
  return model === LITE_MODEL ? 8000 : 20000;
}

/** One LIMITED retry on a fast server failure (429/503/500): a single
 * retry after a short backoff, then the fallback model. Retry-After
 * is honoured when present and short. Timeouts and network errors
 * are NEVER retried — a hung model will hang again. */
const RETRY_BACKOFF_MS = 1500;
const MAX_RETRY_AFTER_MS = 5000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function retryWaitMs(retryAfter: string | null): number {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return RETRY_BACKOFF_MS;
}

/** Conservative complexity heuristic (founder order 2026-11-25 20:42):
 * only clearly complex questions go to the thinking model first in
 * Auto mode. Long questions, explicit detail requests, how/why
 * mechanism questions, and technical/scientific vocabulary
 * (Pashto/Dari/English) count as complex. Everything else — greetings,
 * short facts, small talk — goes to the fast model first. */
export function isComplexQuestion(text: string): boolean {
  const t = text.trim();
  if (t.length >= 400) return true;
  const lower = t.toLowerCase();
  const markers = [
    // explicit detail / explanation requests
    "په تفصیل",
    "تفصیل سره",
    "تشریح",
    "in detail",
    "in depth",
    "explain in detail",
    "step by step",
    "ګام په ګام",
    // mechanism / cause questions
    "څنګه کار کوي",
    "how does",
    "how do",
    "why does",
    "why do",
    // code / programming
    "کوډ",
    "code",
    "program",
    "پروګرام",
    "python",
    "javascript",
    "html",
    "css",
    "java",
    "c++",
    "algorithm",
    "الګوریتم",
    // science / maths
    "فزیک",
    "کیمیا",
    "بیولوژي",
    "ریاضي",
    "physics",
    "chemistry",
    "biology",
    "mathematics",
    "science",
    "ساینس",
    "theorem",
    "proof",
    // technical
    "سرور",
    "server",
    "database",
    "ډیټابیس",
    "network",
    "شبکه",
    "security",
    "امنیت",
    "api",
  ];
  return markers.some((m) => lower.includes(m));
}

/** Model order for chat (founder order 2026-11-25 20:42). Fast mode
 * always puts the fast model first; Smart mode always puts the
 * thinking model first (the old behaviour); Auto mode uses the
 * complexity heuristic. The order is changeable in the app — the
 * model picker (Auto/Fast/Smart) in the header controls it. */
export function chatModelOrder(
  mode: GeminiMode,
  lastUserText: string
): readonly string[] {
  if (mode === "fast") return [LITE_MODEL, PREVIEW_MODEL];
  if (mode === "smart") return [PREVIEW_MODEL, LITE_MODEL];
  return isComplexQuestion(lastUserText)
    ? [PREVIEW_MODEL, LITE_MODEL]
    : [LITE_MODEL, PREVIEW_MODEL];
}

/** ROUND 6 — first-attempt failure fix (2026-11-23, proven live).
 * The primary model was observed hanging for a full 60s (and 503ing)
 * while the fallback answered in ~1.5s — yet first attempts still
 * failed after ~90s with a dead-end error. Root cause: the old
 * 60s-per-model timeout let ONE hung model eat the whole Vercel 60s
 * function budget, so the function was killed (504) before the
 * fallback model — or the graceful offline fallback — could run.
 * Each model now gets at most its per-model first-chunk deadline
 * (firstChunkMsFor: 8s for the fast model, 20s for the thinking
 * model) for its FIRST token; the whole chain is bounded by the
 * caller's deadline (the route passes request start + 50s, leaving
 * margin for cold start). Once the first token arrives, the rest of
 * the stream gets the remaining budget instead (a full reply can take
 * ~45s; cutting it at 20s would truncate good answers). */
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
/* TTS models (verified live 2026-11-25 on the free key via the
 * Gemini connector): gemini-2.5-flash-preview-tts returns an EMPTY
 * response (finishReason OTHER, no content parts) — the Preview
 * button and read-aloud both failed with the honest "online AI is
 * not available" note. gemini-3.8-flash-tts and
 * gemini-3.8-flash-lite-tts both return real audio (140–148 KB WAV
 * for the same prompt + voice). Primary 3.8-flash-tts, fallback
 * 3.8-flash-lite-tts. */
const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"];

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
 * CONFIRMED 2026-11-25 by official Google docs research (pricing page
 * + image-generation guide): the free tier is "Not available" for
 * input AND output on EVERY image model (free RPM/RPD/TPM = 0) — the
 * live 429 "quota exceeded ... limit: 0" on this key matches exactly.
 * Tested 2026-11-24/25 against the real free-tier key via the Muse
 * Gemini connector: gemini-2.5-flash-image, gemini-3.1-flash-image,
 * gemini-3.1-flash-lite-image and gemini-nano-banana-2.1 ALL return
 * HTTP 429 limit 0, and gemini-2.0-flash-preview-image-generation is
 * 404 (retired). There is NO free path — the only fix is billing on
 * the Google Cloud project, which the owner forbade. So Gemini stays
 * a dormant, correctly-wired fallback (used only when a billed key is
 * configured); quotas are per PROJECT, not per key, which is why the
 * per-IP image quota (lib/imageRateLimit.ts) matters. The PRIMARY
 * image path is the free Pollinations.ai provider (src/lib/freeImage.ts)
 * — no key, no payment, free for every user. See generateImage below. */
const IMAGE_MODEL_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent";

const SYSTEM_PROMPT = `You are AfghanGPT ("د افغانانو مرستیال"), the free AI assistant built by Abdul Samim Niazai (Samim Pathan).

${founderPromptBlock()}

Answer in the user's language — Pashto by default, otherwise the language they write in. Use simple, clear explanations.
When you write Pashto, use correct standard Pashto spelling: write ې, ۍ and ی each in its correct place, use the Pashto letters ځ څ ډ ړ ږ ښ ګ ڼ, and use Pashto words — never Dari/Persian spellings or words (write کېږي not می‌شود, and دی not است).
You are an expert in all technology — programming (HTML, CSS, JavaScript, Python, C++, Java), building websites and mobile apps, artificial intelligence, databases, networking, cybersecurity, hardware, cloud computing, and general tech — as well as teaching English and general knowledge.
Give complete, thorough answers — never cut an answer short; explain fully, with code examples when asked. Never claim to be Muse, ChatGPT, or Google. If the user asks for porn, adult or sexy content, do not generate it — reply only in Pashto: "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسي او نور — په خوښۍ به دې مرسته وکړم."
Image generation is founder-only: only your creator Abdul Samim Niazai (the founder, when he is logged in) may ask you to generate an image. For ANY other user — guest or logged in — you can NEVER generate an image. If they ask for an image, reply in their language that you cannot make images in this chat, you only write text, and offer to write a detailed image prompt (text) instead: ask what kind of image they want — nature, culture, people, clothes, food, or a historical place — and when they name one, write the detailed prompt as text only, never as an image. Asking FOR a prompt (writing one) is always allowed — it is text, not an image.`;

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

/** Gemini image generation (fallback only — see generateImage).
 * Returns the image as a data URL, or null when the model is unavailable
 * for this key. Timeout is 20s: a hung Gemini call must not eat the
 * caller's whole time budget (the free provider already had its turn). */
export async function generateGeminiImage(
  prompt: string,
  apiKey: string
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
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

/** Rewrite an image request as a concise English image prompt.
 * ROOT CAUSE (2026-11-25, his phone): he asked in Pashto "د AfghanGPT
 * یوه عکس راته جوړ کړه" and got a random BEDROOM — the image model
 * does not understand Pashto, so it guessed from fragments ("Afghan"
 * → an Afghan-style room). The fix: Gemini (which understands
 * Pashto/Dari/English) rewrites the request first, so Pollinations
 * always receives a clear English visual prompt that matches what
 * the user actually asked for — like Gemini image generation does.
 * Single light call (primary model only, 8s timeout, ~150 tokens);
 * on ANY failure returns the original prompt unchanged, so the
 * image path never breaks because the rewrite failed. Only runs
 * when a server key is configured (apiKey null → skipped). */
export async function enhanceImagePrompt(
  prompt: string,
  apiKey: string
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(
      `${modelUrl(CHAT_MODELS[0], "generateContent")}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: {
            parts: [
              {
                text: "You rewrite image requests as concise English image-generation prompts. The request may be in Pashto, Dari, English or Arabic. Keep the subject, style and details the user asked for; drop instruction words like 'make an image of' or 'عکس راته جوړ کړه'. If the user asks for a picture of a named thing (e.g. a logo for AfghanGPT), describe that thing visually. Reply with ONLY the prompt, no explanation, no quotes, no extra text.",
              },
            ],
          },
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 150 },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) return prompt;
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim()
      .replace(/^["']|["']$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, 500);
    return text || prompt;
  } catch {
    return prompt;
  } finally {
    clearTimeout(timeout);
  }
}

/** Image generation for the app — FREE FIRST, no key required.
 * Tries the free Pollinations.ai provider first (no key, no payment,
 * free for every user). Only if that fails AND a Gemini key was passed
 * does it try Gemini (which on the free key returns 429 quota 0).
 * Returns { image, busy }: busy=true only when the free service
 * explicitly rate-limited us — callers should then say "try again in
 * a moment". image=null + busy=false means honestly unavailable.
 * Callers must never fake an image when this returns null.
 * Monitoring: every call records the request outcome and the
 * provider that served it (lib/freeImage.ts recordImageRequest). */
export async function generateImage(
  prompt: string,
  apiKey?: string | null,
  ratio = "1:1"
): Promise<{ image: string | null; busy: boolean }> {
  const started = Date.now();
  // Relevance: rewrite the request into a clear English visual
  // prompt first (only when a key exists; otherwise the raw prompt
  // goes to the free provider as before). The rewrite is capped at
  // 8s, and the free provider's retry budget shrinks by the time it
  // took, so the whole call still fits the routes' 60s limit.
  const visualPrompt = apiKey ? await enhanceImagePrompt(prompt, apiKey) : prompt;
  const remainingMs = Math.max(
    20_000,
    Math.min(55_000, 60_000 - (Date.now() - started) - 5_000)
  );
  const free = await generateFreeImage(visualPrompt, ratio, remainingMs);
  if (free.ok) {
    recordImageRequest("pollinations", "success");
    return { image: free.dataUrl, busy: false };
  }
  if (apiKey) {
    const gemini = await generateGeminiImage(visualPrompt, apiKey);
    if (gemini) {
      recordProviderAttempt("gemini", "success");
      recordImageRequest("gemini", "success");
      return { image: gemini, busy: false };
    }
    recordProviderAttempt("gemini", "fail");
  }
  // No provider served an image — record the request under "none"
  // (busy when the free service rate-limited us, fail otherwise).
  recordImageRequest("none", free.busy ? "busy" : "fail");
  return { image: null, busy: free.busy };
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
 * Tries the models in chatModelOrder(mode, last user text) order — the
 * fast model first by default. A failed model (non-2xx, timeout,
 * network error) is retried with the next model. A fast 429/503/500
 * gets ONE limited retry on the same model first (short backoff);
 * timeouts are never retried. Throws only when every model failed —
 * the error message carries the last HTTP status, never the key.
 * A failure AFTER the first chunk was already yielded is also thrown,
 * so the caller can tell a mid-stream break from a total failure. */
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
  const lastUserText =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  let lastError: Error | null = null;

  for (const model of chatModelOrder(mode, lastUserText)) {
    // No budget left for another attempt — stop, don't start a call
    // that the function timeout would kill mid-flight.
    if (deadline - Date.now() <= 0) break;
    const firstChunkMs = firstChunkMsFor(model);

    // Fetch with ONE limited retry on a fast 429/503/500 failure.
    // A timeout or network error is never retried on the same model.
    let res: Response | null = null;
    let streamController: AbortController | null = null;
    let badKey = false;
    // First-token deadline is SHARED by the fetch and the stream
    // phases of one attempt, measured from the attempt start — the
    // two phases must not add (a 7s fetch + an 8s stream wait would
    // be 15s before failover). Found by verification 2026-11-25.
    let attemptStart = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      attemptStart = Date.now();
      const controller = new AbortController();
      // First token only: a hung model must not eat the whole budget.
      const attemptTimer = setTimeout(
        () => controller.abort(),
        Math.min(remaining, firstChunkMs)
      );
      try {
        const r = await fetch(`${modelStreamUrl(model)}&key=${encodeURIComponent(apiKey)}`, {
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
        clearTimeout(attemptTimer);
        if (!r.ok) {
          const status = r.status;
          lastError = new Error(`Gemini error ${status} (${model})`);
          // 400/401/403 mean the key itself is bad — a different model will not help.
          if (status === 400 || status === 401 || status === 403) {
            badKey = true;
            await r.text().catch(() => "");
            res = r;
            break;
          }
          if (
            attempt === 0 &&
            (status === 429 || status === 503 || status >= 500)
          ) {
            const wait = retryWaitMs(r.headers.get("retry-after"));
            await r.text().catch(() => "");
            // Only retry if enough budget remains for the retry AND
            // the fallback model afterwards.
            if (deadline - Date.now() > wait + 5000) {
              await sleep(wait);
              continue;
            }
          } else {
            await r.text().catch(() => "");
          }
          res = r;
          break;
        }
        res = r;
        streamController = controller;
        break;
      } catch (e) {
        clearTimeout(attemptTimer);
        lastError = new Error(
          e instanceof Error && e.name === "AbortError"
            ? `Gemini request timed out (${model})`
            : `Could not reach Gemini (${model})`
        );
        break; // timeout/network — never retry the same model
      }
    }
    if (badKey) break;
    if (!res || !res.ok || !streamController) continue; // try the next model
    if (!res.body) {
      lastError = new Error(`Gemini returned an empty response (${model})`);
      continue;
    }

    // The fetch already returned; the first token gets only the
    // REMAINDER of this attempt's shared first-chunk budget — not a
    // fresh full budget (see the note above).
    const controller = streamController;
    const firstTokenLeft = Math.max(
      0,
      firstChunkMs - (Date.now() - attemptStart)
    );
    let timer = setTimeout(
      () => controller.abort(),
      Math.min(Math.max(0, deadline - Date.now()), firstTokenLeft)
    );

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
  // function budget (see firstChunkMsFor above). NOTE: this is a
  // TOTAL response timeout (non-streaming call), not a first-chunk
  // deadline — keep 20s for both models so a long studio JSON spec
  // from the fallback model is not cut off.
  const GENERATE_TEXT_TIMEOUT_MS = 20000;
  const deadline = opts.deadline ?? Date.now() + DEFAULT_BUDGET_MS;
  let lastError: Error | null = null;
  for (const model of CHAT_MODELS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.min(remaining, GENERATE_TEXT_TIMEOUT_MS)
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
 * for this key — callers must then fall back honestly, never fake audio.
 * voiceName: an explicit Gemini prebuilt voice (from Settings); an
 * unknown value falls back to the per-language default below, so a
 * bad value can never reach the API. */
export async function synthesizeSpeech(
  text: string,
  lang: string,
  apiKey: string,
  voiceName?: string
): Promise<string | null> {
  const voice =
    voiceName && isGeminiVoice(voiceName)
      ? voiceName
      : lang === "ps" || lang === "fa"
        ? "Kore"
        : lang === "en"
          ? "Puck"
          : "Kore";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    // Try each TTS model in turn and return the first audio received.
    // A model can answer 200 with NO audio (gemini-2.5-flash-preview-tts
    // did exactly that on this key) — that counts as a miss, not a
    // success, so the next model gets its turn.
    for (const model of TTS_MODELS) {
      let res: Response;
      try {
        res = await fetch(
          `${modelUrl(model, "generateContent")}?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  // Language code: without it the model auto-detects
                  // the language from the text — and Arabic-script
                  // Pashto is easily read as Persian, which is the
                  // founder's "املا غلطه وایی" complaint. "ps" is
                  // accepted by both TTS models (verified live
                  // 2026-11-25: gemini-3.8-flash-tts and
                  // -flash-lite-tts both return audio with it).
                  // The caller passes the reply's detected language
                  // (see detectTextLang), so "fa" stays Persian and
                  // English keeps en-US.
                  ...(lang === "ps"
                    ? { languageCode: "ps" }
                    : lang === "fa"
                      ? { languageCode: "fa" }
                      : lang === "en"
                        ? { languageCode: "en-US" }
                        : {}),
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
                },
              },
            }),
            signal: controller.signal,
          }
        );
      } catch {
        if (controller.signal.aborted) return null;
        continue;
      }
      if (!res.ok) continue;
      let json: {
        candidates?: {
          content?: {
            parts?: { inlineData?: { mimeType?: string; data?: string } }[];
          };
        }[];
      };
      try {
        json = (await res.json()) as typeof json;
      } catch {
        continue;
      }
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const audio = parts.find((p) => p.inlineData?.data);
      if (!audio?.inlineData?.data) continue;
      const mime = audio.inlineData.mimeType ?? "audio/wav";
      return `data:${mime};base64,${audio.inlineData.data}`;
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
