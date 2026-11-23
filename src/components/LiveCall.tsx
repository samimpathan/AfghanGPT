"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Image from "next/image";
import { t, type Lang } from "@/lib/i18n";
import {
  transcribeRecording,
  playGeminiSpeech,
  speakText,
  stopSpeaking,
  hasSpeechVoice,
  detectTextLang,
  isMediaRecorderSupported,
  type GeminiAudio,
} from "@/lib/voice";

/**
 * LiveCall.tsx — Gemini Live-style real-time voice call (v3.2).
 *
 * Architecture (the browser NEVER holds the real key):
 *   1. POST /api/live-token mints a short-lived ephemeral token
 *      server-side from GEMINI_API_KEY || GEMINIAPIKEY.
 *   2. The client opens a WebSocket to the Gemini Live API with it.
 *      Ephemeral tokens work ONLY on the *Constrained* endpoint:
 *      the plain BidiGenerateContent endpoint takes a raw API key
 *      (?key=...) and rejects an ephemeral token, closing the
 *      socket at once. That was FAILURE B (2026-11-23): the call
 *      never connected and the mic was never requested, because
 *      the mic only starts after the socket connects. Google docs:
 *      "Ephemeral authentication tokens ... used with
 *      GenerativeService.BidiGenerateContentConstrained, either by
 *      passing the token in an `access_token` query parameter"
 *      (ai.google.dev/api/live, "Ephemeral authentication tokens";
 *      also aistudio.google.com/docs/live-api/get-started-websocket,
 *      "Authentication with ephemeral tokens").
 *      wss://generativelanguage.googleapis.com/ws/
 *      google.ai.generativelanguage.v1beta.GenerativeService
 *      .BidiGenerateContentConstrained?access_token=<token>
 *      The token IS the `name` field of the auth_tokens response
 *      ("auth_tokens/<hex>") - the docs say "pass the value under
 *      token.name back to your client"; there is no `token` field.
 *   3. Mic audio streams as 16kHz PCM; the AI's 24kHz PCM audio
 *      plays back. Camera / screen-share frames go as Live video
 *      input (JPEG, ~1 fps) so the AI can see the screen and
 *      answer about it.
 *   Models tried in order: gemini-3.8-live (current Live model),
 *   then gemini-2.5-flash-native-audio-preview-12-2025. The old
 *   names (gemini-2.5-flash-preview-native-audio-dialog,
 *   gemini-live-2.5-flash-preview) are dead for this key: both
 *   return HTTP 404 NOT_FOUND from GET v1beta/models/<name>.
 *
 * HONEST FALLBACK: if the token route or the Live API is not
 * available for this key, this screen does NOT pretend a live call
 * works — it switches to push-to-talk voice mode (record ->
 * transcribe -> voice reply) and says so clearly, naming WHICH
 * step failed (token mint / socket open / setup) instead of one
 * generic fallback note, so a re-test can tell them apart.
 * A live call uses a lot of data — a Wi-Fi note is shown.
 * The adult-refusal rule is in the Live session system instruction.
 */

const LIVE_MODELS = [
  // Current Live model (docs' example model everywhere; verified
  // 2026-11-23 via GET v1beta/models/<name> with the real key:
  // HTTP 200, methods ["bidiGenerateContent"]).
  "gemini-3.8-live",
  // Still alive for this key (same probe: HTTP 200). The old names
  // gemini-2.5-flash-preview-native-audio-dialog and
  // gemini-live-2.5-flash-preview both return HTTP 404 NOT_FOUND.
  "gemini-2.5-flash-native-audio-preview-12-2025",
] as const;

const LIVE_SYSTEM = `You are "د عبدالصمیم مرستیال" (Samim AI), the free voice AI assistant of Abdul Samim Niazai (Samim Pathan), founder of DevConnect. You are talking to the user by voice, live. Answer in the user's language — Pashto by default, otherwise the language they speak in. Keep spoken answers short and simple, like a natural conversation. You are an expert in all technology — programming, websites, mobile apps, AI, databases, networking, cybersecurity, hardware and cloud — as well as teaching English and general knowledge. If the user shows you their screen or camera, describe and help with what you see. Never claim to be Muse, ChatGPT, or Google. If the user asks for porn, adult or sexy content, do not generate it — reply only in Pashto: "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسی او نور — په خوښۍ به دې مرسته وکړم."`;

type Phase = "connecting" | "live" | "fallback" | "error";
type TranscriptLine = { role: "user" | "assistant"; text: string };

/** TTS voice language for the Live session (Google docs:
 * "Configure language and voice" — cloud.google.com/vertex-ai/
 * generative-ai/docs/live-api/configure-language-voice).
 * The Live models switch languages naturally and follow the
 * system instruction; languageCode only steers the TTS voice.
 * Only codes Google lists for Live are sent (en-US, ar-EG are in
 * the published list). Pashto/Dari omit it - sending an unlisted
 * code could fail setup - and the system instruction + automatic
 * input detection (languageCodes: [] below) carry the language
 * instead. */
const LIVE_VOICE_LANG: Partial<Record<Lang, string>> = {
  en: "en-US",
  ar: "ar-EG",
};

function b64FromInt16(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(bytes.length, i + CHUNK);
    const chars = new Array<string>(end - i);
    for (let j = i; j < end; j++) chars[j - i] = String.fromCharCode(bytes[j]);
    binary += chars.join("");
  }
  return btoa(binary);
}

function int16FromB64(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export default function LiveCall({
  lang,
  onClose,
  onNote,
  onOpenMenu,
}: {
  lang: Lang;
  /** Called on End call, with the call transcript to keep in the chat. */
  onClose: (transcript: TranscriptLine[]) => void;
  onNote?: (text: string) => void;
  /** ChatGPT voice screen: the hamburger opens the chat drawer. */
  onOpenMenu?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [fallbackListening, setFallbackListening] = useState(false);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  /** Gemini live bottom sheet (Screen share / Photos / Files). */
  const [sheetOpen, setSheetOpen] = useState(false);
  /** The live transcript under the orb can be hidden (sliders button). */
  const [showTranscript, setShowTranscript] = useState(true);
  const liveFileInputRef = useRef<HTMLInputElement | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef(0);
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Delayed "describe the screen" prompt after sharing starts. */
  const describeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const frameTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const micOnRef = useRef(true);
  const transcriptRef = useRef<TranscriptLine[]>([]);
  const stoppedRef = useRef(false);
  const fallbackRecRef = useRef<MediaRecorder | null>(null);
  const fallbackChunksRef = useRef<Blob[]>([]);
  const geminiAudioRef = useRef<GeminiAudio | null>(null);
  micOnRef.current = micOn;

  const addLine = useCallback((role: "user" | "assistant", text: string) => {
    const line = { role, text };
    transcriptRef.current = [...transcriptRef.current, line];
    setTranscript(transcriptRef.current);
  }, []);

  /** t() returns the key itself when the coordinator has not added
   * it to i18n.ts yet — fall back to English so the user (and the
   * AI, for prompts) never sees a raw key. */
  const tx = (key: string, fallback: string): string => {
    const v = t(lang, key);
    return v === key ? fallback : v;
  };

  /** Ask the Live model (by voice) to describe what it sees. A
   * video frame alone does not make the model speak — it answers
   * when spoken to, or when a text turn arrives. Sent as a
   * clientContent turn (the Live API's text input), in the UI
   * language. No-op when no Live session is open. */
  const askLiveToDescribe = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const prompt = tx(
      "liveDescribeImage",
      "Please describe what you see and help me with it, and answer by voice."
    );
    try {
      ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: "user", parts: [{ text: prompt }] }],
            turnComplete: true,
          },
        })
      );
    } catch {
      // one lost prompt must not break the call
    }
  }, [lang]);

  const stopAllTracks = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    micStreamRef.current = null;
    videoStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    videoStreamRef.current = null;
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    if (describeTimerRef.current) clearTimeout(describeTimerRef.current);
    describeTimerRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    void playCtxRef.current?.close().catch(() => {});
    playCtxRef.current = null;
    if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
    stopSpeaking();
    geminiAudioRef.current?.stop();
    geminiAudioRef.current = null;
    // stop() on an already-inactive MediaRecorder throws
    // InvalidStateError — the call is ending either way.
    try {
      fallbackRecRef.current?.stop();
    } catch {
      // already stopped — ignore
    }
    fallbackRecRef.current = null;
  }, []);

  const endCall = useCallback(() => {
    stoppedRef.current = true;
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    stopAllTracks();
    onClose(transcriptRef.current);
  }, [onClose, stopAllTracks]);

  /** Voice-screen hamburger (photo 4): end the call and open the
   * chat drawer, like the reference app. */
  const openMenu = useCallback(() => {
    endCall();
    onOpenMenu?.();
  }, [endCall, onOpenMenu]);

  // Keep the transcript visible; End call is the only way out.
  useEffect(() => () => stopAllTracks(), [stopAllTracks]);

  /** Queue one 24kHz PCM chunk for playback; the avatar pulses while audio plays. */
  const playPcmChunk = useCallback((b64: string) => {
    try {
      if (!playCtxRef.current) {
        playCtxRef.current = new AudioContext({ sampleRate: 24000 });
      }
      const ctx = playCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const int16 = int16FromB64(b64);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.getChannelData(0).set(float32);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      src.start(startAt);
      nextPlayTimeRef.current = startAt + buffer.duration;
      setSpeaking(true);
      if (speakTimerRef.current) clearTimeout(speakTimerRef.current);
      speakTimerRef.current = setTimeout(
        () => setSpeaking(false),
        Math.max(600, buffer.duration * 1000 + 300)
      );
    } catch {
      // playback failure must not kill the call
    }
  }, []);

  /** Send one video frame (camera or screen) as Live video input. */
  const sendVideoFrame = useCallback(() => {
    const video = videoElRef.current;
    const ws = wsRef.current;
    if (!video || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    try {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return;
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
      const data = dataUrl.split(",")[1] ?? "";
      ws.send(
        JSON.stringify({
          // realtimeInput.mediaChunks is DEPRECATED (api.live:
          // "Use one of audio, video, or text instead") - video
          // frames go in the `video` field (get-started-websocket).
          realtimeInput: { video: { mimeType: "image/jpeg", data } },
        })
      );
    } catch {
      // ignore one bad frame
    }
  }, []);

  const startVideoFrames = useCallback(() => {
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = setInterval(sendVideoFrame, 1000);
  }, [sendVideoFrame]);

  /** Start mic capture: ScriptProcessor -> 16kHz Int16 PCM -> Live. */
  const startMic = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    micStreamRef.current = stream;
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    const inputRate = ctx.sampleRate;
    const ratio = Math.max(1, Math.round(inputRate / 16000));
    processor.onaudioprocess = (e) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || !micOnRef.current) return;
      const input = e.inputBuffer.getChannelData(0);
      const out = new Int16Array(Math.floor(input.length / ratio));
      for (let i = 0, j = 0; j < out.length; i += ratio, j++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        out[j] = s < 0 ? s * 32768 : s * 32767;
      }
      try {
        ws.send(
          JSON.stringify({
            realtimeInput: {
              audio: { mimeType: "audio/pcm;rate=16000", data: b64FromInt16(out) },
            },
          })
        );
      } catch {
        // ignore
      }
    };
    source.connect(processor);
    processor.connect(ctx.destination);
  }, []);

  /**
   * Connect with one model. Returns { ok: true } when the session is
   * live, otherwise WHICH step failed, so the UI can say so honestly
   * instead of one generic fallback:
   *   token  - /api/live-token failed (no key / minting failed)
   *   socket - the WebSocket never opened (handshake rejected, or
   *            closed before setup; close code captured when known)
   *   setup  - the socket opened but the server rejected the setup
   *            (error message captured) or never sent setupComplete
   * The mic is deliberately NOT requested here: startMic runs only
   * after this returns ok, so a socket/setup failure means no mic
   * prompt ever appears - that is expected, not a mic bug.
   */
  type ConnectResult =
    | { ok: true }
    | {
        ok: false;
        step: "token" | "socket" | "setup";
        detail: string;
        noKey?: boolean;
      };
  const connectWithModel = useCallback(
    async (model: string): Promise<ConnectResult> => {
      // Fresh ephemeral token per attempt (tokens are single-use).
      let tokenRes: Response;
      try {
        tokenRes = await fetch("/api/live-token", { method: "POST" });
      } catch {
        return { ok: false, step: "token", detail: "token request failed" };
      }
      if (!tokenRes.ok) {
        let code = "";
        try {
          code = ((await tokenRes.json()) as { error?: string }).error ?? "";
        } catch {
          // non-JSON error body - the status below is enough
        }
        return {
          ok: false,
          step: "token",
          detail: `HTTP ${tokenRes.status}${code ? ` ${code}` : ""}`,
          noKey: code === "no-key",
        };
      }
      const { token } = (await tokenRes.json()) as { token?: string };
      if (!token) {
        return { ok: false, step: "token", detail: "empty token" };
      }
      // Ephemeral tokens go ONLY to the Constrained endpoint (see the
      // file header). The token value is "auth_tokens/<hex>" - its
      // alphabet is URL-safe in a query value, so it is passed raw,
      // exactly as in Google's own example (?access_token=<token>),
      // not percent-encoded.
      const wsUrl =
        "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=" +
        token;
      return await new Promise<ConnectResult>((resolve) => {
        let settled = false;
        let opened = false;
        let serverError: string | null = null;
        let closeCode: number | null = null;
        let closeReason = "";
        // onerror carries no detail and is normally followed at once
        // by onclose, which DOES carry the code - so wait up to 1s
        // for onclose before settling, instead of losing the code.
        let failTimer: ReturnType<typeof setTimeout> | null = null;
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;
        const failDetail = (): string => {
          if (!opened) {
            if (closeCode !== null) {
              return `closed ${closeCode}${closeReason ? ` (${closeReason})` : ""}`;
            }
            return "handshake failed";
          }
          if (serverError) return serverError.slice(0, 120);
          return "no setupComplete in 20s";
        };
        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (failTimer) clearTimeout(failTimer);
          if (!ok) {
            try {
              ws.close();
            } catch {
              // ignore
            }
            if (wsRef.current === ws) wsRef.current = null;
            resolve({
              ok: false,
              step: !opened ? "socket" : "setup",
              detail: failDetail(),
            });
            return;
          }
          resolve({ ok: true });
        };
        const setupTimer = setTimeout(() => settle(false), 20000);
        ws.onopen = () => {
          opened = true;
          ws.send(
            JSON.stringify({
              setup: {
                model: `models/${model}`,
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } },
                    // Voice language, only for codes Google lists for
                    // the Live models (see LIVE_VOICE_LANG above).
                    // Pashto/Dari omit it — the system instruction
                    // + automatic detection carry the language.
                    ...(LIVE_VOICE_LANG[lang]
                      ? { languageCode: LIVE_VOICE_LANG[lang] }
                      : {}),
                  },
                },
                systemInstruction: { parts: [{ text: LIVE_SYSTEM }] },
                // languageCodes: [] = automatic language detection
                // (Google default, made explicit): the model detects
                // the spoken language across utterances, including
                // code-switching, and the system instruction tells
                // it to answer in that language.
                inputAudioTranscription: { languageCodes: [] },
                outputAudioTranscription: {},
              },
            })
          );
        };
        ws.onmessage = (event) => {
          let msg: {
            setupComplete?: unknown;
            serverContent?: {
              modelTurn?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
              turnComplete?: boolean;
              interrupted?: boolean;
              inputTranscription?: { text?: string };
              outputTranscription?: { text?: string };
            };
            error?: { message?: string };
          };
          try {
            msg = JSON.parse(String(event.data));
          } catch {
            return;
          }
          if (msg.error) {
            serverError = msg.error.message ?? "setup rejected";
            clearTimeout(setupTimer);
            settle(false);
            return;
          }
          if (msg.setupComplete !== undefined) {
            clearTimeout(setupTimer);
            setPhase("live");
            settle(true);
            return;
          }
          const sc = msg.serverContent;
          if (!sc) return;
          if (sc.inputTranscription?.text) addLine("user", sc.inputTranscription.text);
          if (sc.outputTranscription?.text) addLine("assistant", sc.outputTranscription.text);
          for (const part of sc.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) playPcmChunk(part.inlineData.data);
          }
          if (sc.interrupted) setSpeaking(false);
        };
        ws.onerror = () => {
          clearTimeout(setupTimer);
          if (failTimer) return;
          failTimer = setTimeout(() => settle(false), 1000);
        };
        ws.onclose = (ev) => {
          closeCode = ev.code;
          closeReason = ev.reason ?? "";
          clearTimeout(setupTimer);
          // A close before setup means this model failed; after setup
          // it means the call dropped — fall back honestly.
          if (!settled) settle(false);
          else if (!stoppedRef.current) {
            setPhase((p) => (p === "live" ? "fallback" : p));
            setErrorNote(t(lang, "liveFallbackNote"));
          }
        };
      });
    },
    [addLine, playPcmChunk, lang]
  );

  /** Try the Live API; on any failure switch to push-to-talk. */
  const startLive = useCallback(async () => {
    let lastFail: Extract<ConnectResult, { ok: false }> | null = null;
    for (const model of LIVE_MODELS) {
      if (stoppedRef.current) return;
      const res = await connectWithModel(model);
      if (res.ok) {
        try {
          await startMic();
        } catch (err) {
          // Live connected but the mic is dead (denied / no mic).
          // A "live" call that cannot hear the user would be fake —
          // close the session and fall back to push-to-talk honestly.
          // Only a real denial gets the permission note — no mic
          // found / mic busy is not a permission problem.
          const name = (err as { name?: string } | null)?.name ?? "";
          const denied = name === "NotAllowedError" || name === "SecurityError";
          try {
            wsRef.current?.close();
          } catch {
            // ignore
          }
          wsRef.current = null;
          setPhase("fallback");
          setErrorNote(t(lang, denied ? "micPermission" : "micNotSupported"));
        }
        return;
      }
      lastFail = res;
    }
    if (stoppedRef.current) return;
    // No Live model worked for this key — honest fallback, not a fake
    // call. Say WHICH step failed (token / socket / setup) plus the
    // captured detail, so a re-test can tell the causes apart.
    setPhase("fallback");
    const f = lastFail;
    if (!f) {
      setErrorNote(t(lang, "liveUnavailable"));
      return;
    }
    const base =
      f.step === "token"
        ? t(lang, f.noKey ? "liveNoKey" : "liveTokenFailed")
        : t(lang, "liveUnavailable");
    setErrorNote(`${base} (${f.step}: ${f.detail})`);
  }, [connectWithModel, startMic, lang]);

  useEffect(() => {
    startLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- video sources (camera / screen share) ---------- */

  const stopVideo = useCallback(() => {
    videoStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    videoStreamRef.current = null;
    if (frameTimerRef.current) clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
    if (describeTimerRef.current) clearTimeout(describeTimerRef.current);
    describeTimerRef.current = null;
    setCameraOn(false);
    setScreenOn(false);
  }, []);

  const toggleCamera = async () => {
    if (cameraOn) {
      stopVideo();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stopVideo();
      videoStreamRef.current = stream;
      setCameraOn(true);
      setScreenOn(false);
      startVideoFrames();
    } catch {
      // Camera denial is not a microphone problem — say so.
      onNote?.(
        tx("cameraPermission", "Please allow camera access and try again.")
      );
    }
  };

  const toggleScreen = async () => {
    if (screenOn) {
      stopVideo();
      return;
    }
    // No Live session (push-to-talk fallback): frames have nowhere
    // to go, so a "sharing" badge would lie. Use the photo path —
    // the user photographs their screen and the AI answers by
    // voice through the fallback flow (onLiveFilePicked below).
    if (phase !== "live") {
      liveFileInputRef.current?.click();
      return;
    }
    // Honest check first: getDisplayMedia is not in every browser
    // (Chrome on Android does not support it at all). The button
    // must never be dead — open the photo picker instead, so the
    // user photographs their screen and the Live AI sees it.
    if (!navigator.mediaDevices?.getDisplayMedia) {
      onNote?.(t(lang, "liveScreenUnsupported"));
      liveFileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      stopVideo();
      videoStreamRef.current = stream;
      setScreenOn(true);
      setCameraOn(false);
      startVideoFrames();
      // Frames alone do not make the model speak — after a frame
      // or two has arrived, ask it by voice to describe the screen.
      if (describeTimerRef.current) clearTimeout(describeTimerRef.current);
      describeTimerRef.current = setTimeout(askLiveToDescribe, 1200);
      // The user can stop sharing from the browser UI too.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopVideo);
    } catch {
      // FAILURE 2 fix: the API exists but the call was denied (user
      // cancels / browser blocks it) — the old code only showed the
      // blocked toast and left the user with no working path. Same
      // photo fallback as the missing-API branch above, so the
      // button always leads to a working path.
      onNote?.(t(lang, "liveScreenUnsupported"));
      liveFileInputRef.current?.click();
    }
  };

  // Attach the active video stream to the preview element.
  useEffect(() => {
    const el = videoElRef.current;
    if (el && videoStreamRef.current) el.srcObject = videoStreamRef.current;
  }, [cameraOn, screenOn]);

  /* ---------- push-to-talk fallback (record -> transcribe -> voice reply) ---------- */

  /** Ask /api/chat for a reply and read it aloud in the reply's own
   * language (device voice first, Gemini TTS second). Shared by the
   * push-to-talk voice flow and the photo-question flow, so both
   * answer by voice. `messages` is the full history to send —
   * callers must NOT append the last user turn again after already
   * adding it to the transcript (the old inline code did exactly
   * that and sent the last user message twice). */
  const answerFallbackByVoice = useCallback(
    async (
      messages: { role: "user" | "assistant"; content: string; image?: string }[]
    ) => {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, mode: "auto" }),
      });
      if (!res.ok || !res.body) throw new Error("chat failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
      }
      if (!full.trim()) return;
      addLine("assistant", full);
      const replyLang = detectTextLang(full);
      setSpeaking(true);
      if (hasSpeechVoice(replyLang)) {
        const ok = speakText(full, replyLang, () => setSpeaking(false));
        if (ok) return;
      }
      const played = await playGeminiSpeech(full, replyLang, () => setSpeaking(false));
      if (played) {
        geminiAudioRef.current = played;
        return;
      }
      setSpeaking(false);
      onNote?.(t(lang, "voiceTtsUnavailable"));
    },
    [addLine, lang, onNote]
  );

  const fallbackToggleMic = async () => {
    if (fallbackBusy) return;
    if (fallbackListening) {
      fallbackRecRef.current?.stop();
      return;
    }
    if (!isMediaRecorderSupported()) {
      onNote?.(t(lang, "micNotSupported"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      fallbackRecRef.current = rec;
      fallbackChunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) fallbackChunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setFallbackListening(false);
        const blob = new Blob(fallbackChunksRef.current, { type: rec.mimeType || "audio/webm" });
        if (blob.size === 0) return;
        setFallbackBusy(true);
        try {
          const text = await transcribeRecording(blob);
          if (!text) {
            onNote?.(t(lang, "micNoSpeech"));
            return;
          }
          addLine("user", text);
          // Answer by voice: text chat, then read the reply aloud.
          // transcriptRef already holds the new user line — send it
          // as-is, do not append the text a second time.
          await answerFallbackByVoice(
            transcriptRef.current.map((l) => ({ role: l.role, content: l.text }))
          );
        } catch (e) {
          if (e instanceof Error && (e as Error & { code?: string }).code === "no-key") {
            onNote?.(t(lang, "voiceNeedsOnline"));
          } else {
            onNote?.(t(lang, "errorGeneric"));
          }
        } finally {
          setFallbackBusy(false);
        }
      };
      rec.start();
      setFallbackListening(true);
    } catch (err) {
      // Only a real denial gets the permission note — no mic found
      // / mic busy / aborted is not a permission problem.
      const name = (err as { name?: string } | null)?.name ?? "";
      onNote?.(
        t(
          lang,
          name === "NotAllowedError" || name === "SecurityError"
            ? "micPermission"
            : "micNotSupported"
        )
      );
    }
  };

  const toggleMic = () => {
    if (phase === "fallback") {
      void fallbackToggleMic();
      return;
    }
    setMicOn((v) => !v);
  };

  /** Send one picked image to the Live session as video input, so
   * the AI can see and answer about it. Frames alone do not make
   * the model speak, so it is also asked by voice to describe what
   * it sees. Honest guard: when no Live session is open there is
   * nowhere to send it — the caller routes to the fallback flow. */
  const sendLiveImage = async (file: File) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onNote?.(t(lang, "liveUnavailable"));
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const data = dataUrl.split(",")[1] ?? "";
      ws.send(
        JSON.stringify({
          realtimeInput: {
            video: { mimeType: file.type || "image/jpeg", data },
          },
        })
      );
      onNote?.(t(lang, "liveImageSent"));
      askLiveToDescribe();
    } catch {
      onNote?.(t(lang, "errorGeneric"));
    }
  };

  /** Fallback phase has no Live session: answer a picked photo the
   * same way push-to-talk answers voice — /api/chat (which sees
   * images) + read the reply aloud. This is the working screen
   * alternative on phones: photograph the screen, the AI describes
   * it by voice. */
  const sendFallbackImage = async (file: File) => {
    if (fallbackBusy) return;
    setFallbackBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read"));
        reader.readAsDataURL(file);
      });
      const prompt = tx(
        "liveDescribeImage",
        "Please describe what you see and help me with it, and answer by voice."
      );
      const messages = [
        ...transcriptRef.current.map((l) => ({ role: l.role, content: l.text })),
        { role: "user" as const, content: prompt, image: dataUrl },
      ];
      addLine("user", prompt);
      await answerFallbackByVoice(messages);
    } catch (e) {
      if (e instanceof Error && (e as Error & { code?: string }).code === "no-key") {
        onNote?.(t(lang, "voiceNeedsOnline"));
      } else {
        onNote?.(t(lang, "errorGeneric"));
      }
    } finally {
      setFallbackBusy(false);
    }
  };

  /** The + sheet's Files button (and the screen-share fallback):
   * Live session open -> send the image to Live; otherwise answer
   * it through the fallback voice flow. Never a dead button. */
  const onLiveFilePicked = async (file: File | undefined) => {
    if (!file) return;
    if (phase === "live") {
      await sendLiveImage(file);
      return;
    }
    await sendFallbackImage(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#EDEDED] text-slate-900 dark:bg-[#080D1B] dark:text-white">
      {/* Header (photo 4 — ChatGPT voice screen): two white circles,
          hamburger left, sliders right. No title/pills here — the
          status lives under the orb. */}
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <button
          type="button"
          onClick={openMenu}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-2xl leading-none text-slate-900 shadow-md transition active:scale-95 dark:bg-[#111B30] dark:text-white dark:ring-1 dark:ring-[#263550]"
          aria-label="Menu"
        >
          ≡
        </button>
        <button
          type="button"
          onClick={() => setShowTranscript((v) => !v)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow-md transition active:scale-95 dark:bg-[#111B30] dark:text-white dark:ring-1 dark:ring-[#263550]"
          aria-label={t(lang, "liveTranscript")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <line x1="4" y1="7" x2="20" y2="7" />
            <circle cx="9" cy="7" r="2.4" fill="currentColor" stroke="none" />
            <line x1="4" y1="17" x2="20" y2="17" />
            <circle cx="15" cy="17" r="2.4" fill="currentColor" stroke="none" />
          </svg>
        </button>
      </div>

      {/* BIG glowing gold orb (ChatGPT-style voice screen) with the
          AI photo inside it — it breathes while listening and pulses
          harder while the AI speaks. The orb is large on a phone
          (photo 4: about half the screen width). */}
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div
          className={`voice-orb flex h-72 w-72 items-center justify-center rounded-full sm:h-80 sm:w-80 ${
            speaking ? "voice-orb-speaking" : ""
          }`}
        >
          {/* Face-zoom frame (see globals.css .ai-avatar-frame):
              /avatar.jpg is a 3:4 full-body portrait, so a plain
              128px object-cover circle left the face a speck inside
              the 288px orb. The frame clips a 2.3x zoom on the face. */}
          <span className="ai-avatar-frame h-32 w-32 ring-4 ring-white/60">
            <Image
              src="/avatar.jpg"
              alt="Samim AI"
              width={128}
              height={128}
              className="ai-avatar-img"
              priority
            />
          </span>
        </div>
        <p className="mt-5 text-lg font-bold">{t(lang, "appName")}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {phase === "connecting"
            ? t(lang, "liveConnecting")
            : phase === "live"
              ? speaking
                ? t(lang, "liveSpeaking")
                : t(lang, "liveListening")
              : fallbackListening
                ? t(lang, "recording")
                : fallbackBusy
                  ? t(lang, "voiceTranscribing")
                  : t(lang, "liveTapToTalk")}
        </p>
        <p className="mt-2 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {phase === "live" && (
            <span className="flex items-center gap-1.5 rounded-full bg-red-500/25 px-2.5 py-1 text-[11px] font-bold text-red-600 dark:text-red-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 dark:bg-red-400" />
              {t(lang, "liveNow")}
            </span>
          )}
          {screenOn && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#2457FF]/20 px-2.5 py-1 text-[11px] font-bold text-sky-700 dark:bg-[#2457FF]/30 dark:text-sky-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#00D4FF]" />
              {t(lang, "liveScreenSharing")}
            </span>
          )}
        </p>
        {errorNote && (
          <p className="mt-4 max-w-md rounded-2xl bg-black/5 px-4 py-2.5 text-center text-xs leading-relaxed text-amber-800 dark:bg-white/10 dark:text-amber-200">
            {errorNote}
          </p>
        )}
        <p className="mt-3 text-center text-[11px] text-slate-400">
          <Icon name="wifi" size={14} className="me-1 inline-block align-middle" /> {t(lang, "liveNeedsWifi")}
        </p>

        {/* Live transcript (hidden with the sliders button). */}
        {transcript.length > 0 && showTranscript && (
          <div className="chat-scroll mt-4 max-h-44 w-full max-w-md overflow-y-auto rounded-2xl bg-black/[0.04] p-3 text-start text-sm leading-relaxed dark:bg-white/5">
            <p className="mb-1 text-xs font-bold text-slate-400">{t(lang, "liveTranscript")}</p>
            {transcript.slice(-6).map((l, i) => (
              <p key={i} dir="auto" className="bidi-plaintext mb-1">
                <span className="font-bold text-sky-600 dark:text-sky-300">
                  {l.role === "user" ? t(lang, "youSaid") : t(lang, "aiSaid")}{" "}
                </span>
                {l.text}
              </p>
            ))}
          </div>
        )}

        {/* Camera / screen preview — what the AI sees */}
        {(cameraOn || screenOn) && (
          <div className="relative mt-4 w-full max-w-md">
            <video
              ref={videoElRef}
              autoPlay
              muted
              playsInline
              className="max-h-44 w-full rounded-2xl bg-black object-cover ring-1 ring-black/10 dark:ring-white/20"
            />
            {screenOn && (
              <span className="absolute start-2 top-2 flex items-center gap-1.5 rounded-full bg-red-500 px-2.5 py-1 text-[11px] font-bold text-white shadow">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                {t(lang, "liveScreenSharing")}
              </span>
            )}
            <p className="mt-1.5 text-center text-[11px] text-slate-400">
              {screenOn ? t(lang, "liveScreenPreview") : t(lang, "liveCameraPreview")}
            </p>
          </div>
        )}
      </div>

      {/* Bottom sheet (Gemini-style): Screen share / Photos / Files.
          Screen share + Photos toggle the live camera/screen feeds;
          "Images" sends one picked image to the Live session (the
          input only accepts images, so it is labelled Images, not
          Files, which would promise any file type). */}
      <input
        ref={liveFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label={t(lang, "images")}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onLiveFilePicked(f);
          e.target.value = "";
        }}
      />
      {sheetOpen && (
        <div className="mx-auto w-full max-w-md px-4 pb-2">
          <div className="rounded-[28px] bg-white p-3 pt-2 shadow-xl dark:bg-[#111B30] dark:ring-1 dark:ring-[#263550]">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden />
            <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={toggleScreen}
              className={`flex flex-col items-center justify-center gap-2 rounded-3xl px-2 py-6 text-sm font-medium transition active:scale-95 ${
                screenOn
                  ? "bg-[#2457FF] text-white"
                  : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
              }`}
            >
              <Icon name="screen" size={32} />
              {t(lang, "screenShare")}
            </button>
            <button
              type="button"
              onClick={toggleCamera}
              className={`flex flex-col items-center justify-center gap-2 rounded-3xl px-2 py-6 text-sm font-medium transition active:scale-95 ${
                cameraOn
                  ? "bg-[#2457FF] text-white"
                  : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white"
              }`}
            >
              <Icon name="camera" size={32} />
              {t(lang, "photos")}
            </button>
            <button
              type="button"
              onClick={() => liveFileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-3xl bg-slate-100 px-2 py-6 text-sm font-medium text-slate-900 transition active:scale-95 dark:bg-slate-800 dark:text-white"
            >
              <Icon name="image" size={32} />
              {t(lang, "images")}
            </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom row (photo 4): the pill holds ONLY + and "Ask Samim";
          the mic is its OWN white circle next to it, then the BLACK
          X ends the call. */}
      <div className="px-4 pb-8">
        <div className="mx-auto flex max-w-md items-center gap-2">
          <div className="flex h-14 min-w-0 flex-1 items-center gap-1 rounded-full bg-white px-2 shadow-md dark:bg-[#111B30] dark:ring-1 dark:ring-[#263550]">
            <button
              type="button"
              onClick={() => setSheetOpen((v) => !v)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-slate-900 transition hover:bg-slate-100 active:scale-95 dark:text-white dark:hover:bg-slate-800"
              aria-label={t(lang, "screenShare")}
            >
              <Icon name="plus" size={24} />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm text-slate-500">
              {t(lang, "askSamim")}
            </span>
          </div>
          <button
            type="button"
            onClick={toggleMic}
            disabled={fallbackBusy}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl shadow-md transition active:scale-95 disabled:opacity-40 ${
              phase === "fallback"
                ? fallbackListening
                  ? "bg-red-500 text-white mic-listening"
                  : "bg-white text-slate-900 dark:bg-[#111B30] dark:text-white dark:ring-1 dark:ring-[#263550]"
                : micOn
                  ? "bg-white text-slate-900 dark:bg-[#111B30] dark:text-white dark:ring-1 dark:ring-[#263550]"
                  : "bg-red-500 text-white"
            }`}
            aria-label={micOn ? t(lang, "liveMicOn") : t(lang, "liveMicOff")}
          >
            {phase === "fallback" ? (fallbackListening ? <Icon name="stop" size={22} /> : <Icon name="mic" size={22} />) : micOn ? <Icon name="mic" size={22} /> : <Icon name="volumeOff" size={22} />}
          </button>
          <button
            type="button"
            onClick={endCall}
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-black text-2xl text-white shadow-md transition active:scale-95 dark:bg-white dark:text-black"
            aria-label={t(lang, "endCall")}
          >
            <Icon name="x" size={24} />
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-400">
          {phase === "fallback"
            ? t(lang, "liveFallbackNote")
            : t(lang, "liveTapToTalk")}
        </p>
      </div>
    </div>
  );
}
