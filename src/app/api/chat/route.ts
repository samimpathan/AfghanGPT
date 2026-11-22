import { NextRequest } from "next/server";
import { streamGemini, generateImage, type ChatMsg } from "@/lib/gemini";
import { getOfflineAnswer } from "@/lib/offlineBrain";
import { isAdultRequest, ADULT_REFUSAL_PS } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Photo questions need the online AI — the offline brain cannot see images. */
const PHOTO_OFFLINE_NOTE =
  "د عکس په اړه پوښتنې لپاره آنلاین AI پکار دی — د Gemini کېلي اضافه کړه. / Photo questions need the online AI — please add a Gemini key.";

/** Image generation is not available for this key — never fake an image. */
const IMAGE_GEN_UNAVAILABLE =
  "بښنه غواړم، د عکس جوړول اوس شتون نه لري — دا کیلي د عکس جوړولو ملاتړ نه کوي. بله پوښتنه وکړه! / Sorry, image generation is not available right now — this key does not support it. Please ask something else!";

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

export async function POST(req: NextRequest) {
  let body: { messages?: ChatMsg[] };
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

  // Real Gemini, streamed. On any failure → offline fallback, labelled.
  try {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of streamGemini(messages, apiKey)) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        } catch {
          // Fall back inside the same stream: label stays "offline"
          // via the fallback path below — instead, enqueue offline text.
          const fallback = getOfflineAnswer(lastText);
          for (const w of fallback.split(/(?<=\s)/)) {
            controller.enqueue(encoder.encode(w));
          }
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-SamimAI-Mode": "gemini",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return textStream(getOfflineAnswer(lastText), "offline");
  }
}
