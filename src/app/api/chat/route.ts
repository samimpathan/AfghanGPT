import { NextRequest } from "next/server";
import { streamGemini, generateImage, type ChatMsg, type GeminiMode } from "@/lib/gemini";
import { getOfflineAnswer, isPashto } from "@/lib/offlineBrain";
import { isAdultRequest, ADULT_REFUSAL_PS } from "@/lib/safety";
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

/** Photo questions need the online AI — the offline brain cannot see images. */
const PHOTO_OFFLINE_NOTE =
  "د عکس په اړه پوښتنې لپاره آنلاین AI پکار دی — د Gemini کېلي اضافه کړه. / Photo questions need the online AI — please add a Gemini key.";

/** Image generation is not available for this key — never fake an image. */
const IMAGE_GEN_UNAVAILABLE =
  "بښنه غواړم، د عکس جوړول اوس شتون نه لري — دا کیلي د عکس جوړولو ملاتړ نه کوي. بله پوښتنه وکړه! / Sorry, image generation is not available right now — this key does not support it. Please ask something else!";

/* ================= File creation (v3.2) =================
 * The user wants REAL files (docx/xlsx/pptx/pdf/txt/md/csv/json/
 * html/zip), not just talk about them. Detection needs BOTH a
 * file-type word AND a creation verb, so "what is a pdf?" does
 * not trigger it. Adult content is refused above, before this. */

const FILE_CREATE_VERB =
  /(جوړ|جوړوه|جوړ کړه|راکړه|راکړی|ولېږه|make|create|build|generate|write|download|دانلود|فایل|file)/i;

function detectFileRequest(text: string): FileType | null {
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

function fileSpecSchema(type: FileType): string {
  switch (type) {
    case "docx":
      return `{"type":"docx","filename":"name.docx","docx":{"title":"...","sections":[{"heading":"...","paragraphs":["..."],"table":[["a","b"],["c","d"]]}]}}`;
    case "xlsx":
      return `{"type":"xlsx","filename":"name.xlsx","xlsx":{"sheets":[{"name":"Sheet1","rows":[["col1","col2"],["a","b"]]}]}}`;
    case "pptx":
      return `{"type":"pptx","filename":"name.pptx","pptx":{"title":"...","slides":[{"title":"...","bullets":["..."],"notes":"..."}]}}`;
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
  apiKey: string | undefined
): Promise<Response | null> {
  const pashto = isPashto(lastText);
  if (!apiKey) {
    // File content is written by Gemini — without a key there is
    // nothing honest to put in the file.
    return textStream(
      pashto
        ? "د فایل جوړولو لپاره آنلاین AI پکار دی — د Gemini کېلي اضافه کړه."
        : "Making a file needs the online AI — please add a Gemini key.",
      "offline"
    );
  }
  const instruction =
    `The user asked for a real ${type.toUpperCase()} file. Their request: "${lastText}". ` +
    `Write the full file content in the user's language. ` +
    `Reply with ONLY strict JSON (no markdown fences, no explanation, no extra text) matching this schema exactly: ` +
    fileSpecSchema(type) +
    ` Keep it complete but reasonable in size (max 200 slides/rows, max 50 files in a zip).` +
    ` For a zip of code, put each file's full code in "content" (e.g. index.html + style.css + script.js for a website).`;
  const specMessages: ChatMsg[] = [
    ...messages.slice(0, -1),
    { role: "user", content: instruction },
  ];
  let raw = "";
  try {
    for await (const chunk of streamGemini(specMessages, apiKey, "smart")) {
      raw += chunk;
    }
  } catch (e) {
    console.error("File spec failed:", e instanceof Error ? e.message : "unknown");
    return textStream(
      pashto
        ? "بښنه غواړم، فایل جوړ نه شو — بیا هڅه وکړه."
        : "Sorry, the file could not be made — please try again.",
      "busy"
    );
  }
  // Repair pass: strip fences, then take the outermost {...} object.
  let jsonText = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = jsonText.indexOf("{");
  const last = jsonText.lastIndexOf("}");
  if (first >= 0 && last > first) jsonText = jsonText.slice(first, last + 1);
  let spec: FileSpec;
  try {
    spec = JSON.parse(jsonText) as FileSpec;
  } catch {
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
 * say so honestly — do NOT pretend the offline brain is the real answer,
 * and do NOT claim the owner must add a key (it is already added). */
function busyMessageFor(text: string): string {
  if (!isPashto(text) && /[a-zA-Z]/.test(text)) {
    return "The AI is busy right now — please try again in a moment.";
  }
  return "AI اوس بوخت دی / یو څه ځنډ دی — لږ وروسته بیا هڅه وکړه.";
}

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMsg[]; mode?: string };
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

  // Real file creation (docx/xlsx/pptx/pdf/txt/md/csv/json/html/zip).
  // Adult content was already refused above, so this is safe to run.
  const fileType = !lastImage ? detectFileRequest(lastText) : null;
  if (fileType) {
    const fileRes = await handleFileRequest(messages, lastText, fileType, apiKey);
    if (fileRes) return fileRes;
    // Null means "could not do it" — fall through to normal chat.
  }

  // Image generation (text-only request, no photo attached).
  if (!lastImage && isImageGenRequest(lastText)) {
    if (!apiKey) {
      return textStream(IMAGE_GEN_UNAVAILABLE, "offline");
    }
    const image = await generateImage(lastText, apiKey);
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
    return textStream(IMAGE_GEN_UNAVAILABLE, "gemini");
  }

  // No key (or empty) → honest offline fallback, clearly labelled.
  if (!apiKey) {
    return textStream(getOfflineAnswer(lastText), "offline");
  }

  // Real Gemini, streamed. Pull the first chunk BEFORE responding, so a
  // total failure (503/429/timeout on a slow connection, even after the
  // model fallback) can be reported honestly as "busy" instead of
  // silently falling back to the offline brain and lying that the owner
  // must add a key — the key IS added. A failure mid-stream (after chunks
  // were already sent) just closes the stream; the partial reply stays.
  const chatMode: GeminiMode =
    body.mode === "fast" || body.mode === "smart" ? body.mode : "auto";
  let gen: AsyncGenerator<string>;
  let first: IteratorResult<string>;
  try {
    gen = streamGemini(messages, apiKey, chatMode);
    first = await gen.next();
  } catch (e) {
    // Server log only: status/message, never the key.
    console.error("Gemini failed:", e instanceof Error ? e.message : "unknown");
    return textStream(busyMessageFor(lastText), "busy");
  }
  if (first.done) {
    console.error("Gemini failed: empty response");
    return textStream(busyMessageFor(lastText), "busy");
  }
  try {
    const encoder = new TextEncoder();
    const firstChunk = first.value;
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(firstChunk));
        try {
          for await (const chunk of gen) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (e) {
          console.error(
            "Gemini stream broke mid-reply:",
            e instanceof Error ? e.message : "unknown"
          );
          // Partial reply already sent — just stop here.
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
    return textStream(busyMessageFor(lastText), "busy");
  }
}
