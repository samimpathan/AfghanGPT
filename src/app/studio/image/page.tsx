/**
 * /studio/image — Image Studio: real text-to-image via /api/image,
 * history in localStorage, and honest "not available yet" states for
 * background removal and enhancement (no service is wired in).
 */
"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { store, uid, type StudioImage } from "@/lib/store";
import { Btn, Card, Field, Select, Spinner, Textarea } from "@/components/ui";

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;

const STYLES = [
  { value: "", label: "No style" },
  { value: "Photo", label: "Photo" },
  { value: "Illustration", label: "Illustration" },
  { value: "Digital art", label: "Digital art" },
  { value: "Logo", label: "Logo" },
  { value: "Poster", label: "Poster" },
] as const;

type Generated = { dataUrl: string; prompt: string; ratio: string };

function errorMessage(status: number, code: string): string {
  if (status === 503 || code === "no-key")
    return "Image generation is not available right now. No image was created.";
  if (status === 502 || code === "model-unavailable")
    return "The image model is unavailable right now. No image was created. Please try again later.";
  if (status === 429 || code === "rate-limited")
    return "Too many image requests — please wait a minute and try again (429 rate-limited). No image was created.";
  if (status === 400 && code === "refused")
    return "This prompt was refused for safety reasons. No image was created.";
  if (status === 400 && code === "empty-prompt") return "Please write a prompt first.";
  return `Image generation failed (${status || "network error"}${code ? ` ${code}` : ""}). No image was created.`;
}

export default function ImageStudioPage() {
  const { t } = useLang();
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState<string>("1:1");
  const [style, setStyle] = useState("");
  const [generating, setGenerating] = useState(false);
  const [varying, setVarying] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<Generated | null>(null);
  const [savedCurrent, setSavedCurrent] = useState(false);
  const [history, setHistory] = useState<StudioImage[]>([]);
  const [viewing, setViewing] = useState<StudioImage | Generated | null>(null);

  useEffect(() => {
    // Logged-in users load their image history from localStorage;
    // guests work in memory only (refreshAuthMode sets the mode).
    store.refreshAuthMode().then(() => {
      setHistory(store.images());
    });
  }, []);

  function fullPrompt(base: string, styleValue: string): string {
    const p = base.trim();
    return styleValue ? `${p}, ${styleValue.toLowerCase()} style` : p;
  }

  async function callImageApi(text: string, ratioValue: string): Promise<string> {
    const res = await fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: text, ratio: ratioValue }),
    });
    const json = (await res.json().catch(() => ({}))) as { image?: string; error?: string };
    if (!res.ok || !json.image) {
      throw new Error(errorMessage(res.status, json.error ?? ""));
    }
    return json.image;
  }

  function persistHistory(next: StudioImage[]): void {
    setHistory(next);
    store.saveImages(next);
  }

  function addToHistory(dataUrl: string, promptText: string, ratioValue: string): StudioImage {
    const item: StudioImage = { id: uid(), prompt: promptText, dataUrl, ratio: ratioValue, ts: Date.now() };
    persistHistory([item, ...history]);
    return item;
  }

  async function handleGenerate(): Promise<void> {
    if (!prompt.trim()) {
      setError("Please write a prompt first.");
      return;
    }
    setError("");
    setGenerating(true);
    setSavedCurrent(false);
    try {
      const text = fullPrompt(prompt, style);
      const image = await callImageApi(text, ratio);
      setCurrent({ dataUrl: image, prompt: text, ratio });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Image generation failed. No image was created.";
      setError(msg);
      store.log("studio/image", msg);
    } finally {
      setGenerating(false);
    }
  }

  function handleSaveCurrent(): void {
    if (!current) return;
    addToHistory(current.dataUrl, current.prompt, current.ratio);
    setSavedCurrent(true);
  }

  async function handleVariation(): Promise<void> {
    const base = current?.prompt ?? prompt.trim();
    if (!base) {
      setError("Generate an image first, or write a prompt, to make a variation.");
      return;
    }
    setError("");
    setVarying(true);
    try {
      const text = `${base} — variation, different composition, same subject`;
      const image = await callImageApi(text, current?.ratio ?? ratio);
      const item = addToHistory(image, text, current?.ratio ?? ratio);
      setCurrent({ dataUrl: image, prompt: text, ratio: item.ratio });
      setSavedCurrent(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Variation failed. No image was created.";
      setError(msg);
      store.log("studio/image", msg);
    } finally {
      setVarying(false);
    }
  }

  function handleDelete(id: string): void {
    persistHistory(history.filter((h) => h.id !== id));
    if (viewing && "id" in viewing && viewing.id === id) setViewing(null);
  }

  function downloadName(item: { prompt: string; ts?: number }): string {
    const slug = item.prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";
    return `${slug}.png`;
  }

  return (
    <AppShell title={t("image")} subtitle={t("imageSubtitle")} icon="image">
      <div className="space-y-4">
      <Card>
        <div className="space-y-3">
          <Field label="Prompt">
            <Textarea
              rows={3}
              dir="auto"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A snowy mountain village at sunrise, warm lights in the windows…"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Aspect ratio">
              <Select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                {RATIOS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Style">
              <Select value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Btn onClick={handleGenerate} disabled={generating || !prompt.trim()} className="w-full">
            {generating ? "Generating…" : t("generate")}
          </Btn>
          {generating && <Spinner label="Generating your image…" />}
          {error && (
            <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </div>
      </Card>

      {current && (
        <Card>
          <p className="mb-2 text-sm font-semibold">{t("imageGenerated")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.dataUrl} alt={current.prompt} className="w-full rounded-xl border border-[var(--card-border)]" />
          <p className="mt-2 break-words text-xs text-[var(--muted)]" dir="auto">{current.prompt} · {current.ratio}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={current.dataUrl} download={downloadName(current)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand2)] px-4 py-2.5 text-sm font-semibold text-white transition active:scale-95">
              {t("download")}
            </a>
            <Btn variant="outline" onClick={handleSaveCurrent} disabled={savedCurrent}>
              {savedCurrent ? (<>Saved to history <Icon name="check" size={14} className="ms-1 inline-block align-middle" /></>) : "Save to history"}
            </Btn>
            <Btn variant="outline" onClick={() => setViewing(current)}>View large</Btn>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-1 text-base font-semibold">{t("imageTools")}</h2>
        <p className="mb-3 text-xs text-[var(--muted)]">Only Variations actually processes an image. The other two are honest placeholders until a service is connected.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-[var(--card-border)] p-3">
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
              <Icon name="image" size={18} />
            </span>
            <p className="text-sm font-semibold">Background removal</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Background removal is not available yet. Your image is not processed.
            </p>
            <Btn variant="outline" size="sm" disabled className="mt-2">Remove background</Btn>
          </div>
          <div className="rounded-2xl border border-[var(--card-border)] p-3">
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
              <Icon name="sparkles" size={18} />
            </span>
            <p className="text-sm font-semibold">Enhancement</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Enhancement is not available yet — no upscaler is wired in. Your image is not processed.
            </p>
            <Btn variant="outline" size="sm" disabled className="mt-2">Enhance image</Btn>
          </div>
          <div className="rounded-2xl border border-[var(--card-border)] p-3">
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
              <Icon name="grid" size={18} />
            </span>
            <p className="text-sm font-semibold">Variations</p>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Generates a new image from the same prompt with &ldquo;variation&rdquo; added, and saves it as a new history item.
            </p>
            <Btn variant="outline" size="sm" onClick={handleVariation} disabled={varying || (!current && !prompt.trim())} className="mt-2">
              {varying ? "Generating variation…" : "Make a variation"}
            </Btn>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold">{t("imageHistory")} ({history.length})</h2>
        {history.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
              <Icon name="image" size={24} />
            </span>
            <p className="text-sm text-[var(--muted)]">No images yet. Generate one above and save it to see it here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {history.map((item) => (
              <div key={item.id} className="overflow-hidden rounded-xl border border-[var(--card-border)]">
                <button type="button" onClick={() => setViewing(item)} className="block w-full" aria-label={`View image: ${item.prompt}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.dataUrl} alt={item.prompt} className="aspect-square w-full object-cover" />
                </button>
                <div className="p-2">
                  <p className="line-clamp-2 break-words text-xs" dir="auto">{item.prompt}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    {item.ratio} · {new Date(item.ts).toLocaleString()}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <a href={item.dataUrl} download={downloadName(item)} className="flex-1 rounded-lg border border-[var(--card-border)] px-2 py-1.5 text-center text-xs font-semibold">
                      {t("download")}
                    </a>
                    <button type="button" onClick={() => handleDelete(item.id)} className="flex-1 rounded-lg bg-red-600 px-2 py-1.5 text-xs font-semibold text-white">
                      {t("delete")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {viewing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewing(null)}
          role="dialog"
          aria-label="Image preview"
        >
          <div className="max-h-full w-full max-w-2xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewing.dataUrl} alt={viewing.prompt} className="w-full rounded-xl" />
            <p className="mt-2 break-words text-sm text-white" dir="auto">{viewing.prompt}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={viewing.dataUrl} download={downloadName(viewing)} className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">
                {t("download")}
              </a>
              <Btn variant="ghost" onClick={() => setViewing(null)} className="bg-white/10 text-white">{t("close")}</Btn>
            </div>
          </div>
        </div>
      )}
      </div>
    </AppShell>
  );
}
