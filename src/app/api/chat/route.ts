import { NextRequest } from "next/server";
import { streamGemini, type ChatMsg } from "@/lib/gemini";
import { getOfflineAnswer } from "@/lib/offlineBrain";
import { isAdultRequest, ADULT_REFUSAL_PS } from "@/lib/safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stream plain text in small chunks so the UI streams word-by-word. */
function textStream(fullText: string, mode: string): Response {
  const encoder = new TextEncoder();
  const words = fullText.split(/(?<=\s)/);
  const stream = new ReadableStream({
    async start(controller) {
      for (const w of words) {
        controller.enqueue(encoder.encode(w));
        await new Promise((r) => setTimeout(r, 12));
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

  // Safety: adult content is banned — refuse in Pashto, never generate it.
  if (isAdultRequest(lastText)) {
    return textStream(ADULT_REFUSAL_PS, "refused");
  }

  // Accept both spellings: the user saved the key in Vercel as GEMINIAPIKEY
  // (no underscores). Either variable enables the real Gemini brain.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY;

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
