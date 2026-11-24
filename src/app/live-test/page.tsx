"use client";

// TEMPORARY DIAGNOSTIC PAGE — /live-test (preview only).
// Tries 4 Live API handshake variants and logs the result of each:
//   V1: v1beta + gemini-3.8-live            (what the app uses now)
//   V2: v1alpha + gemini-3.8-live
//   V3: v1beta + gemini-2.5-flash-native-audio-latest
//   V4: v1alpha + gemini-2.5-flash-native-audio-latest
// Each variant mints a FRESH ephemeral token (uses: 1) from /api/live-token,
// opens the Constrained WebSocket, sends the app's exact setup payload and
// waits up to 20s for setupComplete. The page auto-runs on load.
// REMOVE THIS FILE once the working combination is known.

import { useCallback, useEffect, useRef, useState } from "react";

const LIVE_SYSTEM = `You are AfghanGPT ("د افغانانو مرستیال"), the free voice AI assistant built by Abdul Samim Niazai (Samim Pathan), founder of DevConnect and creator of AfghanGPT. You are the AI he built — never confuse the founder with yourself, and never claim to be him. His name in Pashto is "عبدالصمیم نیازی" — always say it and spell it exactly like this, never "عبدالسمیع". Always spell his Latin name exactly "Abdul Samim Niazai". You are talking to the user by voice, live. Answer in the user's language — Pashto by default, otherwise the language they speak in. Keep spoken answers short and simple, like a natural conversation. You are an expert in all technology — programming, websites, mobile apps, AI, databases, networking, cybersecurity, hardware and cloud — as well as teaching English and general knowledge. If the user shows you their screen or camera, describe and help with what you see. Never claim to be Muse, ChatGPT, or Google. If the user asks for porn, adult or sexy content, do not generate it — reply only in Pashto: "دا محتوا نه لرو. نور هر رقم پوښتنه کولای شې — پروګرامینګ، ویبسایټ، انګلیسی او نور — په خوښۍ به دې مرسته وکړم."`;

type Variant = { id: string; api: "v1beta" | "v1alpha"; model: string };
const VARIANTS: Variant[] = [
  { id: "V1", api: "v1beta", model: "gemini-3.8-live" },
  { id: "V2", api: "v1alpha", model: "gemini-3.8-live" },
  { id: "V3", api: "v1beta", model: "gemini-2.5-flash-native-audio-latest" },
  { id: "V4", api: "v1alpha", model: "gemini-2.5-flash-native-audio-latest" },
];

type Result = { id: string; status: "running" | "CONNECTED" | "FAILED"; detail: string };

function wsUrl(api: string, token: string): string {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${api}.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
}

export default function LiveTestPage() {
  const [lines, setLines] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState(false);
  const t0 = useRef(Date.now());
  const logRef = useRef<string[]>([]);
  const log = useCallback((s: string) => {
    const stamp = `[${((Date.now() - t0.current) / 1000).toFixed(1)}s] ${s}`;
    logRef.current = [...logRef.current, stamp];
    setLines([...logRef.current]);
  }, []);
  const setResult = useCallback((r: Result) => {
    setResults((prev) => ({ ...prev, [r.id]: r }));
  }, []);

  const runOne = useCallback(
    async (v: Variant): Promise<void> => {
      const started = Date.now();
      const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
      setResult({ id: v.id, status: "running", detail: "…" });
      log(`=== ${v.id}: ${v.api} + ${v.model} ===`);
      // 1. Fresh token (uses: 1 — one token per variant).
      let token: string | undefined;
      try {
        const res = await fetch("/api/live-token", { method: "POST" });
        const json = (await res.json()) as { token?: string; error?: string };
        if (!res.ok || !json.token) {
          const detail = `token HTTP ${res.status} ${json.error ?? ""} (${elapsed()})`;
          log(`${v.id} TOKEN FAILED: ${detail}`);
          setResult({ id: v.id, status: "FAILED", detail });
          return;
        }
        token = json.token;
        log(`${v.id} token minted OK (${elapsed()})`);
      } catch (e) {
        const detail = `token fetch threw (${elapsed()})`;
        log(`${v.id} TOKEN FAILED: ${detail} ${String(e).slice(0, 120)}`);
        setResult({ id: v.id, status: "FAILED", detail });
        return;
      }
      // 2. WebSocket + setup.
      await new Promise<void>((resolve) => {
        let settled = false;
        let opened = false;
        let ws: WebSocket;
        try {
          ws = new WebSocket(wsUrl(v.api, token as string));
        } catch (e) {
          const detail = `could not open socket (${elapsed()})`;
          log(`${v.id} SOCKET FAILED: ${detail} ${String(e).slice(0, 120)}`);
          setResult({ id: v.id, status: "FAILED", detail });
          resolve();
          return;
        }
        const done = (status: "CONNECTED" | "FAILED", detail: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          log(`${v.id} ${status}: ${detail}`);
          setResult({ id: v.id, status, detail });
          try {
            ws.close();
          } catch {
            // ignore
          }
          resolve();
        };
        const timer = setTimeout(
          () => done("FAILED", opened ? `no setupComplete in 20s (${elapsed()})` : `handshake timed out after 20s (${elapsed()})`),
          20000,
        );
        ws.onopen = () => {
          opened = true;
          log(`${v.id} socket OPEN (${elapsed()}) — sending setup`);
          const setup = JSON.stringify({
            setup: {
              model: `models/${v.model}`,
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
              },
              systemInstruction: { parts: [{ text: LIVE_SYSTEM }] },
              inputAudioTranscription: { languageCodes: [] },
              outputAudioTranscription: {},
            },
          });
          try {
            ws.send(setup);
            log(`${v.id} setup SENT (${elapsed()})`);
          } catch {
            done("FAILED", `setup send failed (${elapsed()})`);
          }
        };
        ws.onmessage = async (event) => {
          // The Live server sends frames as binary Blob — String(blob) is
          // just "[object Blob]" (13 chars, which is why the log showed
          // len=13), so decode it first or setupComplete is never seen.
          let raw: string;
          if (typeof event.data === "string") raw = event.data;
          else if (event.data instanceof Blob) raw = await event.data.text();
          else raw = new TextDecoder().decode(event.data as ArrayBuffer);
          let keys = "?";
          try {
            keys = Object.keys(JSON.parse(raw)).join(",");
          } catch {
            // non-JSON frame
          }
          log(`${v.id} MESSAGE keys=[${keys}] len=${raw.length} head=${raw.slice(0, 200)}`);
          try {
            const msg = JSON.parse(raw) as { setupComplete?: unknown; error?: { message?: string } };
            if (msg.error) {
              done("FAILED", `server error: ${(msg.error.message ?? "").slice(0, 160)} (${elapsed()})`);
              return;
            }
            if (msg.setupComplete !== undefined) {
              done("CONNECTED", `setupComplete received (${elapsed()})`);
            }
          } catch {
            // ignore unparsable frames (already logged)
          }
        };
        ws.onerror = () => {
          log(`${v.id} socket ERROR event (${elapsed()})`);
        };
        ws.onclose = (event) => {
          log(`${v.id} socket CLOSE code=${event.code} reason=${JSON.stringify(event.reason || "")} (${elapsed()})`);
          if (!opened) done("FAILED", `closed ${event.code} before open (${elapsed()})`);
        };
      });
    },
    [log, setResult],
  );

  const runAll = useCallback(async () => {
    if (running) return;
    setRunning(true);
    t0.current = Date.now();
    logRef.current = [];
    setLines([]);
    setResults({});
    log("Live handshake test — 4 variants, 20s each. Started.");
    for (const v of VARIANTS) {
      await runOne(v);
    }
    log("DONE — all 4 variants finished.");
    setRunning(false);
  }, [log, runOne, running]);

  useEffect(() => {
    runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-gray-900 dark:text-gray-100">
      <h1 className="text-xl font-bold">Live API handshake test (temporary)</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Tries 4 combinations of API version × model and reports which one reaches setupComplete. This page is
        temporary and will be removed.
      </p>
      <button
        type="button"
        onClick={runAll}
        disabled={running}
        className="mt-4 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {running ? "Running…" : "Run again"}
      </button>
      <div className="mt-4 space-y-2">
        {VARIANTS.map((v) => {
          const r = results[v.id];
          return (
            <div key={v.id} className="rounded-xl border border-gray-300 p-3 dark:border-gray-700">
              <div className="font-semibold">
                {v.id}: {v.api} + {v.model}
              </div>
              <div className="text-sm">
                {r ? (
                  <>
                    <span
                      className={
                        r.status === "CONNECTED"
                          ? "font-bold text-green-600"
                          : r.status === "FAILED"
                            ? "font-bold text-red-600"
                            : "font-bold text-amber-600"
                      }
                    >
                      {r.status}
                    </span>{" "}
                    — {r.detail}
                  </>
                ) : (
                  "waiting…"
                )}
              </div>
            </div>
          );
        })}
      </div>
      <h2 className="mt-6 font-bold">Log</h2>
      <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-gray-100 p-3 text-xs dark:bg-gray-800">
        {lines.join("\n") || "starting…"}
      </pre>
    </main>
  );
}
