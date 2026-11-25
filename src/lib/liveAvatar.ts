/**
 * liveAvatar.ts — the LIVE-CALL avatar system (independent from the
 * chat second header (ChatSubHeader) in src/app/page.tsx: different
 * component, different state, no shared timers).
 *
 * ENGINE VERDICT (researched + measured 2026-11-25, full note in
 * ~/workspace/afghangpt-live-avatar-research.md):
 * - The ONLY engine that ships is the honest PHOTO engine: the
 *   founder's real seated photo (head to knees, NO feet — the
 *   "head to toe" wording was a founder correction, 2026-11-25),
 *   shown whole with no zoom/crop, plus speaking/listening states
 *   driven by the AI's REAL audio state. No lip sync, no blinking,
 *   no gestures: the photo's mouth is closed and still while the
 *   AI speaks, and the code says so.
 * - NO free/open-source technology can do real phoneme-level lip
 *   sync + head/blink/expressions in real time in a phone browser:
 *   LAM (the only phone-class candidate) needs a 2.36 GB model
 *   (LAM-20K model.safetensors, measured via the HuggingFace API)
 *   + a CUDA GPU server for reconstruction (~100 s/photo) and for
 *   LAM-A2E audio-to-expression (~140 MB + 378 MB wav2vec2-base,
 *   CUDA 11.8/12.1, Python streaming inference, 30 fps
 *   blendshapes); only its WebGL RENDERER runs in a browser, and
 *   it renders a HEAD only — the seated body is not part of the
 *   model. This VM has no GPU (no nvidia-smi, no torch) and
 *   Vercel serverless has none either, so the founder's avatar
 *   asset cannot even be built. The "26 fps on Xiaomi 14" figure
 *   is RENDERING fps of the head, not the audio-to-expression
 *   pipeline.
 * - Rhubarb Lip Sync (offline visemes, C++ binary, file-based)
 *   outputs mouth-shape curves for 2D cartoon mouths; applying
 *   them to the founder's photo would be a puppet — fake
 *   movement, forbidden by the founder. Rejected.
 * - Hand gestures are impossible live from one photo with ANY
 *   current technology (paid or free): talking-head models animate
 *   face + head only; full-body gesture generation is offline
 *   diffusion, seconds per frame, billed per second.
 * - Cheapest REAL path if the founder ever wants a talking avatar:
 *   Simli — free 50 min/month, then ~$0.01/min. Needs his explicit
 *   approval (account + API key + per-minute cost). No account,
 *   key, payment or subscription was created here.
 *
 * A future real engine plugs in by implementing LiveAvatarEngine:
 * it MUST be driven by the AI's real audio (phoneme timing), run
 * in real time in a phone browser, and preserve the founder's
 * likeness. An amplitude-driven mouth or a 2D warp is NOT a real
 * engine — do not ship one under this interface.
 */

export type LiveAvatarState = "loading" | "listening" | "speaking";

export interface LiveAvatarEngine {
  /** "photo" (the only engine that ships) or a future real engine. */
  readonly kind: string;
  /** True ONLY if the mouth is driven by real phoneme timing. */
  readonly phonemeLipSync: boolean;
  readonly headMovement: boolean;
  readonly blinking: boolean;
  readonly handGestures: boolean;
  /** Where the animation is computed: "browser" | "vendor-cloud" | "own-gpu-server". */
  readonly runsOn: string;
  /** Recurring cost, or "free" — never hide a metered cost. */
  readonly cost: string;
}

/** The only engine that ships: the founder's real photo, honestly. */
export const PHOTO_ENGINE: LiveAvatarEngine = {
  kind: "photo",
  phonemeLipSync: false,
  headMovement: false,
  blinking: false,
  handGestures: false,
  runsOn: "browser",
  cost: "free",
};
