import { NextRequest } from "next/server";
import { streamGemini, generateText, generateImage, type ChatMsg, type GeminiMode } from "@/lib/gemini";
import { getOfflineAnswer, getOfflineTopicAnswer, isPashto } from "@/lib/offlineBrain";
import { getFreeWebAnswer, detectLang, isFactualQuestion } from "@/lib/freeweb";
import { isAdultRequest, ADULT_REFUSAL_PS } from "@/lib/safety";
import { normalizeFounderName, guardChatStream } from "@/lib/nameGuard";
import { rateLimited, clientIp } from "@/lib/ratelimit";
import { checkImageRateLimit } from "@/lib/imageRateLimit";
import { isFounderRequest, refusalTextFor } from "@/lib/founderAuth";
import { fetchSlideImages } from "@/lib/slideImages";
import { TRUNCATED_SENTINEL, CONTINUE_INSTRUCTION } from "@/lib/autoContinue";
import {
  generateFile,
  validateSpec,
  contentTypeFor,
  filenameFor,
  type FileSpec,
  type FileType,
} from "@/lib/filegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Vercel Hobby kills serverless functions after 10s by default — a
 * Pashto reply from gemini-3-flash-preview takes ~13s (thinking model),
 * so the stream was cut mid-reply. Hobby allows up to 60s free. */
export const maxDuration = 60;

/** Photo questions need the online AI — the offline brain cannot see images. */
const PHOTO_OFFLINE_NOTE =
  "زه اوس عکسونه نشم لیدلی — مهربانی وکړه خپله پوښتنه په خبرو ولیکه. / I can't see photos right now — please ask with words.";

/** Image generation is not available right now — never fake an image. */
const IMAGE_GEN_UNAVAILABLE =
  "بښنه غواړم، د عکس جوړول اوس شتون نه لری — لږ وروسته بیا هڅه وکړه. / Sorry, image generation isn't available right now — please try again later.";

/** The free image service is rate-limited right now — the request
 * itself is fine, it just has to wait. Shown (instead of the
 * "not available" text above) when generateImage reports busy:
 * the user asked for this exact wording (2026-11-25). */
const IMAGE_GEN_BUSY =
  "د عکس جوړولو خدمت اوس بوخت دی، مهرباني وکړئ لږ انتظار وکړئ. / The image generation service is busy right now — please wait a moment.";

/* ================= File creation (v3.2) =================
 * The user wants REAL files (docx/xlsx/pptx/pdf/txt/md/csv/json/
 * html/zip), not just talk about them. Detection needs BOTH a
 * file-type word AND a creation verb, so "what is a pdf?" does
 * not trigger it. Adult content is refused above, before this. */

const FILE_CREATE_VERB =
  /(جوړ|جوړوه|جوړ کړه|راکړه|راکړی|ولېږه|make|create|build|generate|write|download|دانلود|فایل|file)/i;

function detectFileRequestDirect(text: string): FileType | null {
  if (!FILE_CREATE_VERB.test(text)) return null;
  const lower = text.toLowerCase();
  if (/(pptx|powerpoint|presentation|پریزنټیشن|پرزنټیشن|پریزنتیشن|slides?|سلایډ)/.test(lower)) return "pptx";
  if (/(xlsx|excel|spreadsheet|ایکسل|سپریډشیټ|جدول)/.test(lower)) return "xlsx";
  if (/(docx|\bword\b(?!.*password)|سند|ډاک)/.test(lower)) return "docx";
  if (/(pdf|پی ډی اف|پی‌دی‌اف)/.test(lower)) return "pdf";
  if (/(zip|زیپ|کمپریس)/.test(lower)) return "zip";
  if (/\bcsv\b/.test(lower)) return "csv";
  if (/\bjson\b/.test(lower)) return "json";
  if (/\bhtml\b/.test(lower) || /ویب ?پاڼه/.test(text)) return "html";
  if (/\b(md|markdown)\b/.test(lower)) return "md";
  if (/(txt|متن.*فایل|text file)/.test(lower)) return "txt";
  return null;
}

/** Follow-up file requests: "بل جوړ که" / "make another one"
 * carries no file-type word, but it means "another file like the
 * last one". The founder's 2026-11-25 follow-up ("بل جوړ که عصري")
 * fell through to plain text instead of a new deck. When the
 * message has a creation verb + an "another/new" marker, reuse the
 * most recent file type from the conversation history. */
const FILE_FOLLOWUP =
  /(بل|بله|نوی|نور|another|one more|\bnew\b|\bnext\b)/i;
function detectFileRequest(text: string, messages: ChatMsg[] = []): FileType | null {
  const direct = detectFileRequestDirect(text);
  if (direct) return direct;
  if (!FILE_CREATE_VERB.test(text)) {
    // Bare "another / again" as the whole message, right after a
    // file request — e.g. a single "بل" / "بیا" tap. Unambiguous in
    // context; anything longer without a creation verb is not a
    // file request.
    const bare = text.trim().toLowerCase();
    if (bare !== "بل" && bare !== "بیا" && bare !== "again" && bare !== "another") return null;
  } else if (!FILE_FOLLOWUP.test(text)) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "user" && typeof m.content === "string") {
      const t = detectFileRequestDirect(m.content);
      if (t) return t;
    }
  }
  return null;
}

function fileSpecSchema(type: FileType): string {
  switch (type) {
    case "docx":
      return `{"type":"docx","filename":"name.docx","docx":{"title":"...","sections":[{"heading":"...","paragraphs":["..."],"table":[["a","b"],["c","d"]]}]}}`;
    case "xlsx":
      return `{"type":"xlsx","filename":"name.xlsx","xlsx":{"sheets":[{"name":"Sheet1","rows":[["col1","col2"],["a","b"]]}]}}`;
    case "pptx":
      return `{"type":"pptx","filename":"name.pptx","pptx":{"title":"...","slides":[{"title":"...","bullets":["...","...","...","..."],"notes":"...","imageQuery":"..."}]}}`;
    case "pdf":
      return `{"type":"pdf","filename":"name.pdf","pdf":{"title":"...","lines":["..."]}}`;
    case "zip":
      return `{"type":"zip","filename":"project.zip","files":[{"name":"index.html","content":"..."},{"name":"style.css","content":"..."},{"name":"script.js","content":"..."}]}`;
    case "csv":
      return `{"type":"csv","filename":"name.csv","content":"col1,col2\\na,b"}`;
    case "json":
      return `{"type":"json","filename":"name.json","content":"{\\"key\\": \\"value\\"}"}`;
    case "html":
      return `{"type":"html","filename":"name.html","content":"<!DOCTYPE html><html>...</html>"}`;
    case "md":
      return `{"type":"md","filename":"name.md","content":"# Title\\n..."}`;
    default:
      return `{"type":"txt","filename":"name.txt","content":"..."}`;
  }
}

/** Ask Gemini for a STRICT JSON file spec, then generate the real
 * file server-side. Returns a Response, or null when it could not
 * be done (caller falls back to normal chat). */
async function handleFileRequest(
  messages: ChatMsg[],
  lastText: string,
  type: FileType,
  apiKey: string | undefined,
  deadline: number
): Promise<Response | null> {
  const pashto = isPashto(lastText);
  if (!apiKey) {
    // File content is written by the online AI — when it is not
    // available there is nothing honest to put in the file.
    return textStream(
      pashto
        ? "زه اوس فایل نشم جوړولی — آنلاین AI شتون نه لری. لږ وروسته بیا هڅه وکړه."
        : "I can't make a file right now — the online AI is not available. Please try again later.",
      "offline"
    );
  }
  const instruction =
    `The user asked for a real ${type.toUpperCase()} file. Their request: "${lastText}". ` +
    `Write the full file content in the user's language. ` +
    `Reply with ONLY strict JSON (no markdown fences, no explanation, no extra text) matching this schema exactly: ` +
    fileSpecSchema(type) +
    ` Keep it complete but reasonable in size (max 200 slides/rows, max 50 files in a zip).` +
    (type === "pptx"
      ? ` Every main slide needs 4-6 substantive bullets. Each bullet must be a complete, informative sentence with real detail about the topic — not a two-word fragment. Fill each slide completely with real content before moving to the next slide: a slide with only one or two short lines is not acceptable. Do not pad with filler and do not repeat the same point in different words. Notes are one sentence of speaker notes. For every slide, write a short ENGLISH image search phrase of 2-4 words in "imageQuery" — concrete visual nouns ONLY (e.g. "cloud servers data center"), different for each slide, "" when no image fits.`
      : "") +
    ` For a zip of code, put each file's full code in "content" (e.g. index.html + style.css + script.js for a website).`;
  const specMessages: ChatMsg[] = [
    ...messages.slice(0, -1),
    { role: "user", content: instruction },
  ];
  // One safe retry: the model call is idempotent (it only drafts
  // a spec), and a first attempt often dies on a transient Gemini
  // 503/429/timeout or on malformed JSON — the founder's 2026-11-25
  // first presentation request failed exactly like this and the
  // second one worked. Only after BOTH attempts fail does the user
  // see the failure message. The retry shares the same absolute
  // deadline, so it can never push the request past its budget.
  let spec: FileSpec | null = null;
  // Did the spec fail because Gemini was busy/rate-limited (429/503/
  // timeout)? Then the user gets the honest "busy" message instead of
  // the generic failure text — the founder's 2026-11-25 presentation
  // failed exactly this way while the free key was rate-limited, and
  // the generic text hid the cause (and made a re-send look like it
  // had never run). Malformed-spec failures keep the generic text.
  let specBusy = false;
  for (let attempt = 0; attempt < 2 && !spec; attempt++) {
    let raw = "";
    try {
      for await (const chunk of streamGemini(specMessages, apiKey, "smart", undefined, { deadline })) {
        raw += chunk;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      console.error("File spec failed:", msg);
      specBusy = /429|503|timed out|Could not reach/i.test(msg);
      if (attempt === 1) {
        return textStream(
          specBusy
            ? busyMessageFor(lastText)
            : pashto
              ? "بښنه غواړم، فایل جوړ نه شو — بیا هڅه وکړه."
              : "Sorry, the file could not be made — please try again.",
          "busy"
        );
      }
      continue;
    }
    // Repair pass: strip fences, then take the outermost {...} object.
    let jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const first = jsonText.indexOf("{");
    const last = jsonText.lastIndexOf("}");
    if (first >= 0 && last > first) jsonText = jsonText.slice(first, last + 1);
    try {
      spec = JSON.parse(jsonText) as FileSpec;
    } catch {
      if (attempt === 1) {
        return textStream(
          pashto
            ? "بښنه غواړم، فایل جوړ نه شو — بیا هڅه وکړه."
            : "Sorry, the file could not be made — please try again.",
          "busy"
        );
      }
    }
  }
  if (!spec) {
    return textStream(
      pashto
        ? "بښنه غواړم، فایل جوړ نه شو — بیا هڅه وکړه."
        : "Sorry, the file could not be made — please try again.",
      "busy"
    );
  }
  if (spec.type !== type) spec.type = type;
  if (validateSpec(spec)) {
    return textStream(
      pashto
        ? "بښنه غواړم، فایل جوړ نه شو — بیا هڅه وکړه."
        : "Sorry, the file could not be made — please try again.",
      "busy"
    );
  }
  // PPTX topic images (chat decks had none — founder 2026-11-25):
  // the model wrote an imageQuery per slide; fetch a real photo
  // per slide (Openverse first, Wikimedia fallback — free, no key)
  // and attach it as slide.image, which buildPptx downloads and
  // embeds as a separate picture shape. Bounded by the remaining
  // request budget (minus a reserve for the build): when the fetch
  // runs out of time the deck still exports text-only, and a
  // failed fetch never breaks the file.
  if (type === "pptx" && spec.pptx?.slides) {
    const queries = spec.pptx.slides.map((s) => {
      const q = (s as { imageQuery?: unknown }).imageQuery;
      return typeof q === "string" ? q.trim().slice(0, 80) : "";
    });
    if (queries.some(Boolean)) {
      const remaining = deadline - Date.now();
      const budget = Math.min(15000, Math.max(0, remaining - 5000));
      if (budget > 3000) {
        try {
          const images = await Promise.race([
            fetchSlideImages(queries),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), budget)),
          ]);
          if (images) {
            spec.pptx.slides.forEach((s, i) => {
              const img = images[i];
              if (img) s.image = { url: img.url, credit: img.credit };
            });
          }
        } catch {
          // images are optional — the deck still exports text-only
        }
      }
    }
  }
  let buffer: Buffer;
  try {
    buffer = await generateFile(spec);
  } catch {
    return textStream(
      pashto
        ? "بښنه غواړم، فایل جوړ نه شو — بیا هڅه وکړه."
        : "Sorry, the file could not be made — please try again.",
      "busy"
    );
  }
  // Base64 in the JSON reply is capped at ~5 MB — bigger files are
  // refused honestly instead of crashing the chat.
  if (buffer.length > 5 * 1024 * 1024) {
    return textStream(
      pashto
        ? "فایل ډېر لوی شو — کوچنی فایل وغواړه."
        : "The file turned out too large — please ask for a smaller one.",
      "busy"
    );
  }
  const filename = filenameFor(spec);
  const summary = pashto
    ? `ستا فایل جوړ شو: ${filename} — د ډاونلوډ لپاره لاندې تڼۍ ټکوه.`
    : `Your file is ready: ${filename} — tap Download below to save it.`;
  return new Response(
    JSON.stringify({
      text: summary,
      file: {
        filename,
        mime: contentTypeFor(spec.type),
        size: buffer.length,
        base64: buffer.toString("base64"),
      },
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-SamimAI-Mode": "file",
        "Cache-Control": "no-store",
      },
    }
  );
}

/** Conservative "make me a picture" detection (text only, no photo attached). */
function isImageGenRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (
    /\b(generate|create|make|draw|paint|design)\b.{0,50}\b(image|picture|photo|art|poster|logo|wallpaper)\b/.test(
      lower
    )
  ) {
    return true;
  }
  if (/(عکس|انځور|تصویر).{0,25}(جوړ|جوړوه|رسم|وکړه|راکړه)|جوړ.{0,15}(عکس|انځور|تصویر)/.test(text)) {
    return true;
  }
  return false;
}

/** Stream plain text in small chunks so the UI streams word-by-word.
 * 4ms per word keeps it fast — the old 12ms made replies feel slow. */
function textStream(fullText: string, mode: string): Response {
  const encoder = new TextEncoder();
  const words = fullText.split(/(?<=\s)/);
  const stream = new ReadableStream({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(encoder.encode(w));
        await new Promise((r) => setTimeout(r, 4));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-SamimAI-Mode": mode,
      "Cache-Control": "no-store",
    },
  });
}

/** The key IS configured but Gemini failed (after the model fallback):
 * say so honestly — do NOT pretend the offline brain is the real answer. */
function busyMessageFor(text: string): string {
  if (!isPashto(text) && /[a-zA-Z]/.test(text)) {
    return "The AI is busy right now — please try again in a moment.";
  }
  return "AI اوس بوخت دی / یو څه ځنډ دی — لږ وروسته بیا هڅه وکړه.";
}

/** Free web fallback (mode "web"): a real answer from free public
 * sources (DuckDuckGo / Wikipedia / Google Books), with a source
 * note. Returns null when no source has anything — the caller then
 * falls back to the offline brain or the honest "busy" message. */
async function webFallback(text: string): Promise<Response | null> {
  const web = await getFreeWebAnswer(text, detectLang(text));
  return web ? textStream(web.text, "web") : null;
}

/** Free web fallback, but never past the deadline: if the sources
 * cannot answer within the remaining function budget, give up
 * immediately instead of being killed mid-fallback — the user would
 * get a dead-end error instead of an answer. */
async function webFallbackBefore(text: string, deadline: number): Promise<Response | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 2000) return null;
  const web = await Promise.race([
    webFallback(text),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
  ]);
  return web;
}

/** ROUND 4 — no-key fallback order (the preview has no server key,
 * so this is the path every message takes there):
 *   1. Conversational messages (greetings, who-are-you, small talk,
 *      thanks, goodbyes, …) are answered by the OFFLINE BRAIN first
 *      — they are NEVER web-searched.
 *   2. Only a clearly factual question goes to the free-web sources.
 *   3. Anything else gets the offline brain's honest "couldn't find
 *      it" reply — never a loosely-related web snippet. */
async function noKeyFallback(text: string): Promise<Response> {
  const topic = getOfflineTopicAnswer(text);
  if (topic !== null) return textStream(topic, "offline");
  if (isFactualQuestion(text)) {
    const web = await webFallback(text);
    if (web) return web;
  }
  return textStream(getOfflineAnswer(text), "offline");
}

/** ROUND 4 — Gemini failed although a key IS configured: same order
 * as noKeyFallback, but the last resort is the honest "busy" message
 * (the key exists, so the real AI is expected to work). ROUND 6: the
 * web step is bounded by the deadline — a slow web fallback after a
 * slow Gemini must not push the request past the function timeout. */
async function geminiFailureFallback(text: string, deadline: number): Promise<Response> {
  const topic = getOfflineTopicAnswer(text);
  if (topic !== null) return textStream(topic, "offline");
  if (isFactualQuestion(text)) {
    const web = await webFallbackBefore(text, deadline);
    if (web) return web;
  }
  return textStream(busyMessageFor(text), "busy");
}

export async function POST(req: NextRequest) {
  // ROUND 6: Vercel kills this function at 60s. Every Gemini wait
  // and every fallback must finish inside that budget, with margin
  // for cold start — so all downstream timeouts hang off this one
  // deadline (request start + 50s). The old code gave each model
  // 60s, so one hung model ate the whole budget and the user got a
  // dead-end error instead of the graceful fallback.
  const startedAt = Date.now();
  const deadline = startedAt + 50000;
  // Basic abuse brake: 30 chat requests per minute per IP.
  if (rateLimited(clientIp(req), 30, 60_000)) {
    return new Response(JSON.stringify({ error: "rate-limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }
  let body: {
    messages?: ChatMsg[];
    mode?: string;
    system?: string;
    format?: string;
    continue?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const messages = (body.messages ?? []).filter(
    (m) => m && typeof m.content === "string" && m.content.trim()
  );
  if (messages.length === 0) {
    return new Response("No messages", { status: 400 });
  }

  // AUTO-CONTINUE (founder order 2026-11-25 18:24): the client sends
  // continue=true when the previous part was cut by the 50s budget.
  // A continuation is a pure chat stream: it skips file/image/no-key
  // branches (a cut reply can only come from a Gemini stream), and a
  // failure returns 503 so the client stops the loop and keeps the
  // partial reply — never a fallback text glued onto it.
  const isContinue = body.continue === true;

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = lastUser?.content ?? "";
  const lastImage = lastUser?.image;

  // Safety: adult content is banned — refuse in Pashto, never generate it.
  if (isAdultRequest(lastText)) {
    return textStream(ADULT_REFUSAL_PS, "refused");
  }

  // Accept both spellings: the user saved the key in Vercel as GEMINIAPIKEY
  // (no underscores). Either variable enables the real Gemini brain.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY;

  // A photo question with no key: say so honestly, do not guess about it.
  if (lastImage && !apiKey) {
    return textStream(PHOTO_OFFLINE_NOTE, "offline");
  }

  // Studios: non-streaming JSON mode (strict JSON specs, summaries).
  // Runs BEFORE file/image detection so a studio prompt asking for a
  // presentation or a JSON spec is never hijacked into a file reply.
  // Normal chat (no format) is completely unaffected by this branch.
  const system = typeof body.system === "string" ? body.system.slice(0, 4000) : "";
  const chatMode: GeminiMode =
    body.mode === "fast" || body.mode === "smart" ? body.mode : "auto";
  // A continuation never takes the studio JSON path: it is always a
  // plain chat stream continuing the previous part.
  if (!isContinue && body.format === "json") {
    if (!apiKey) {
      const web = await webFallback(lastText);
      if (web) return web;
      return textStream(getOfflineAnswer(lastText), "offline");
    }
    try {
      const text = normalizeFounderName(
        await generateText(messages, apiKey, chatMode, system, { deadline })
      );
      return new Response(JSON.stringify({ text }), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-SamimAI-Mode": "gemini",
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      console.error("Gemini failed:", e instanceof Error ? e.message : "unknown");
      const web = await webFallbackBefore(lastText, deadline);
      if (web) return web;
      return textStream(busyMessageFor(lastText), "busy");
    }
  }

  // Real file creation (docx/xlsx/pptx/pdf/txt/md/csv/json/html/zip).
  // Adult content was already refused above, so this is safe to run.
  // A continuation never creates a file: it only continues text.
  const fileType =
    !isContinue && !lastImage ? detectFileRequest(lastText, messages) : null;
  if (fileType) {
    const fileRes = await handleFileRequest(messages, lastText, fileType, apiKey, deadline);
    if (fileRes) return fileRes;
    // Null means "could not do it" — fall through to normal chat.
  }

  // Image generation (text-only request, no photo attached).
  // FOUNDER-ONLY (user order 2026-11-25): only the founder, logged
  // in with his account, may generate images. Anyone else — guest
  // or any other logged-in user — gets the refusal text in their
  // own language, deterministically, and NO image generation runs:
  // no Pollinations/Gemini call and no quota is consumed. The check
  // runs BEFORE the quota check so a refused request never spends
  // quota. The founder's own flow below is unchanged.
  // A continuation never generates an image: it only continues text.
  if (!isContinue && !lastImage && isImageGenRequest(lastText)) {
    if (!(await isFounderRequest(req))) {
      return textStream(refusalTextFor(lastText), "refused");
    }
    // Per-IP image quota (10/hour, lib/imageRateLimit.ts): one IP
    // must not exhaust the shared free image quota. Denied requests
    // get the SAME busy message as a provider rate-limit, and the
    // user's message stays in the chat so Regenerate retries it.
    // This check runs ONLY on the image branch — the text-chat path
    // below never touches it, so a limited IP can still chat.
    if (!checkImageRateLimit(clientIp(req)).allowed) {
      return textStream(IMAGE_GEN_BUSY, "gemini");
    }
    const { image, busy } = await generateImage(lastText, apiKey);
    if (image) {
      return new Response(
        JSON.stringify({
          text: "دلته ستا عکس دی: / Here is your image:",
          image,
        }),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-SamimAI-Mode": "image",
            "Cache-Control": "no-store",
          },
        }
      );
    }
    // Busy (rate-limited) is NOT "unavailable": the request itself
    // is fine, it just has to wait — say so plainly, and keep the
    // user's message in the chat so Regenerate retries the same
    // request (the frontend keeps it; nothing is dropped here).
    if (busy) return textStream(IMAGE_GEN_BUSY, "gemini");
    return textStream(IMAGE_GEN_UNAVAILABLE, "gemini");
  }

  // No key (or empty) → offline brain first for conversation, web
  // only for a clearly factual question, else the honest fallback.
  // A continuation without a key returns 503 (the client stops the
  // loop and keeps the partial reply). After this guard apiKey is a
  // string for the rest of the handler.
  if (!apiKey) {
    if (isContinue) {
      return new Response(JSON.stringify({ error: "continue-failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return noKeyFallback(lastText);
  }

  // Real Gemini, streamed. Pull the first chunk BEFORE responding, so a
  // total failure (503/429/timeout on a slow connection, even after the
  // model fallback) falls back in the ROUND 4 order — offline brain
  // for conversation, free web only for a factual question, then the
  // honest "busy" message. A failure mid-stream (after chunks were
  // already sent) just closes the stream; the partial reply stays.
  // (chatMode and system were defined above, before the JSON branch.)
  // A continuation appends the continue instruction to the model's
  // context only (the client already sent the partial reply in the
  // history, so the model knows where it stopped); it is never saved
  // in the chat. A continuation failure returns 503 — the client
  // stops the loop and keeps the partial reply, never a fallback
  // text glued onto it.
  const streamMessages: ChatMsg[] = isContinue
    ? [...messages, { role: "user", content: CONTINUE_INSTRUCTION }]
    : messages;
  let gen: AsyncGenerator<string>;
  let first: IteratorResult<string>;
  try {
    // Name guard: every streamed Gemini reply passes through
    // guardChatStream, so a misspelled founder name (the model
    // sometimes writes عبدالسمیع for عبدالصمیم) is corrected
    // before the user sees it — even split across chunks.
    gen = guardChatStream(
      streamGemini(streamMessages, apiKey, chatMode, system, { deadline })
    );
    first = await gen.next();
  } catch (e) {
    // Server log only: status/message, never the key.
    console.error("Gemini failed:", e instanceof Error ? e.message : "unknown");
    if (isContinue) {
      return new Response(JSON.stringify({ error: "continue-failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return geminiFailureFallback(lastText, deadline);
  }
  if (first.done) {
    console.error("Gemini failed: empty response");
    if (isContinue) {
      return new Response(JSON.stringify({ error: "continue-failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return geminiFailureFallback(lastText, deadline);
  }
  try {
    const encoder = new TextEncoder();
    const firstChunk = first.value;
    // AUTO-CONTINUE MARK (founder order 2026-11-25 18:24, REPLACES
    // the old "write دوام" note the founder rejected): the generator
    // stops at the shared 50s deadline, so a long reply ends with no
    // sign. When the stream was cut — by the deadline, or by a
    // mid-stream error — the server appends TRUNCATED_SENTINEL
    // (four invisible zero-width characters, lib/autoContinue.ts).
    // The client strips it and automatically requests the next part;
    // the user never sees it and never types anything.
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(firstChunk));
        let truncatedNoted = false;
        try {
          for await (const chunk of gen) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (e) {
          console.error(
            "Gemini stream broke mid-reply:",
            e instanceof Error ? e.message : "unknown"
          );
          // Partial reply already sent — mark it as cut, once only.
          controller.enqueue(encoder.encode(TRUNCATED_SENTINEL));
          truncatedNoted = true;
        }
        // Append once only: a mid-stream error AND the deadline can
        // both hit, and the mark must not appear twice.
        if (Date.now() >= deadline && !truncatedNoted) {
          controller.enqueue(encoder.encode(TRUNCATED_SENTINEL));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-SamimAI-Mode": "gemini",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("Gemini failed:", e instanceof Error ? e.message : "unknown");
    if (isContinue) {
      return new Response(JSON.stringify({ error: "continue-failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return geminiFailureFallback(lastText, deadline);
  }
}
