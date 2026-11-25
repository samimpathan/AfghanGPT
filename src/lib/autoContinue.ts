/**
 * Auto-continue (founder order 2026-11-25 18:24): a long reply can be
 * cut by the server's 50s budget (Vercel kills the function at 60s).
 * The founder does NOT want the app to say "write دوام for the rest"
 * — the answer must complete itself, automatically, in consecutive
 * parts of the SAME bubble, without the user typing anything.
 *
 * How it works:
 * - The server appends TRUNCATED_SENTINEL to a stream it cut short
 *   (deadline hit, or a mid-stream error), at most once.
 * - The sentinel is four invisible zero-width characters — it never
 *   shows in the UI, even if a client fails to strip it.
 * - The client strips it and immediately requests the next part
 *   (body.continue = true, with the partial reply in the history);
 *   the server appends CONTINUE_INSTRUCTION to the model's context
 *   only — never saved in the chat.
 * - Streaming stays on until the final part arrives, so the UI never
 *   shows a false "finished" state mid-answer.
 * - MAX_CONTINUATIONS caps the loop (initial reply + 3 parts); a
 *   reply still cut after that simply stays as it is — no note, no
 *   "دوام" prompt, the user can Regenerate.
 */
export const TRUNCATED_SENTINEL = "\u200B\u200C\u200D\u2060";

export const MAX_CONTINUATIONS = 3;

export const CONTINUE_INSTRUCTION =
  "Continue your previous answer exactly from where it stopped. " +
  "If it stopped mid-sentence, complete that sentence first, then continue. " +
  "Do not repeat anything you already wrote. " +
  "Do not add any introduction, apology, or summary. " +
  "Do not start over. " +
  "Just continue the answer in the same language as your previous reply.";
