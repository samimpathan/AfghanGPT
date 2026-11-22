/**
 * lib/gemini.ts — Google Gemini API helper (server-side ONLY).
 * The API key is read from process.env.GEMINI_API_KEY on the server.
 * It is NEVER exposed to the browser and NEVER hardcoded.
 */

export type ChatMsg = { role: "user" | "assistant"; content: string };

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:streamGenerateContent?alt=sse";

const SYSTEM_PROMPT = `You are "د عبدالصمیم مرستیال" (Samim AI), the free AI assistant of Abdul Samim Niazai (Samim Pathan), founder of DevConnect.
Answer in the user's language — Pashto by default, otherwise the language they write in. Use simple, clear explanations.
You are an expert in programming (HTML, CSS, JavaScript, Python, C++, Java), building websites, teaching English, and general knowledge.
Give short, practical answers with code examples when asked. Never claim to be Muse, ChatGPT, or Google. If the user asks for porn, adult or sexy content, do not generate it — reply only in Pashto: "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسي او نور — په خوښۍ به دې مرسته وکړم."`;

function toGeminiContents(messages: ChatMsg[]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
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
