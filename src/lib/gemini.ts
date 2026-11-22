/**
 * lib/gemini.ts — Google Gemini API helper (server-side ONLY).
 * The API key is read from process.env.GEMINI_API_KEY (or GEMINIAPIKEY,
 * the spelling the key was saved under in Vercel) on the server.
 * It is NEVER exposed to the browser and NEVER hardcoded.
 */

export type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  /** Optional attached photo as a data URL (data:<mime>;base64,...). */
  image?: string;
};

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse";

const IMAGE_MODEL_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

const SYSTEM_PROMPT = `You are "د عبدالصمیم مرستیال" (Samim AI), the free AI assistant of Abdul Samim Niazai (Samim Pathan), founder of DevConnect.
Answer in the user's language — Pashto by default, otherwise the language they write in. Use simple, clear explanations.
You are an expert in all technology — programming (HTML, CSS, JavaScript, Python, C++, Java), building websites and mobile apps, artificial intelligence, databases, networking, cybersecurity, hardware, cloud computing, and general tech — as well as teaching English and general knowledge.
Give short, practical answers with code examples when asked. Never claim to be Muse, ChatGPT, or Google. If the user asks for porn, adult or sexy content, do not generate it — reply only in Pashto: "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسي او نور — په خوښۍ به دې مرسته وکړم."`;

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
 * for this key — callers must then say so honestly, never fake an image. */
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

/** Stream Gemini reply text chunk by chunk. Throws on HTTP / network errors. */
export async function* streamGemini(
  messages: ChatMsg[],
  apiKey: string
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_URL}&key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: toGeminiContents(messages),
        generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeout);
    throw new Error(
      e instanceof Error && e.name === "AbortError"
        ? "Gemini request timed out"
        : "Could not reach Gemini"
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("Gemini rate limit (429) — try again in a minute");
    if (res.status === 400 || res.status === 401 || res.status === 403)
      throw new Error(`Gemini key problem (${res.status}) — check GEMINI_API_KEY`);
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 200)}`);
  }
  if (!res.body) throw new Error("Gemini returned an empty response");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
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
            if (part.text) yield part.text;
          }
        } catch {
          // Ignore one malformed SSE line and keep streaming.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
