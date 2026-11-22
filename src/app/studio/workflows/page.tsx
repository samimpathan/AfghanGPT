/**
 * /studio/workflows — Workflow Automation (Flow-style).
 * Build a chain of steps (Input / AI step / Translate / Summarise /
 * Write / Image / Document), save it locally, then run it: steps
 * execute IN SEQUENCE, each step's result shown as it completes.
 * Any step failure stops the run, shows the honest error and saves
 * the run with the error. No Gemini key → the first AI step fails
 * honestly with the API's own offline/busy message. Nothing is faked.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import {
  store,
  uid,
  type StudioWorkflow,
  type WorkflowRun,
  type WorkflowStep,
} from "@/lib/store";
import { chatJson, chatText, downloadFileSpec, type ApiChatMsg } from "@/lib/client";
import type { FileSpec } from "@/lib/filegen";
import { Btn, Card, Field, Input, Select, Spinner, Textarea, Badge } from "@/components/ui";

/** Solid brand button — the shared Btn primary is a gradient; studios use a flat brand colour. */
const SOLID = "!bg-none !bg-[var(--brand2)]";

type StepKind = WorkflowStep["kind"];

const STEP_KINDS: { value: StepKind; label: string }[] = [
  { value: "input", label: "Input" },
  { value: "ai", label: "AI step" },
  { value: "translate", label: "Translate" },
  { value: "summarise", label: "Summarise" },
  { value: "write", label: "Write" },
  { value: "image", label: "Image" },
  { value: "document", label: "Document" },
];

const STEP_HINTS: Record<StepKind, string> = {
  input: "Sets the running text to the workflow input.",
  ai: "Instruction for the AI, e.g. “Rewrite this as a friendly email”.",
  translate: "Target language, e.g. “to Pashto” or “to English”.",
  summarise: "Optional focus, e.g. “in 3 bullet points”.",
  write: "What to write from the text, e.g. “a short blog post”.",
  image: "Optional style hint, e.g. “flat illustration style”.",
  document: "Document title, e.g. “Weekly report”.",
};

type StepResult = {
  stepId: string;
  label: string;
  kind: StepKind;
  output: string;
  imageUrl?: string;
  docSpec?: FileSpec;
  status: "done" | "error";
  error?: string;
};

const DOC_SYSTEM = `You are a document writer. Return ONLY a JSON object with this exact shape, no markdown fences, no explanation:
{"type":"docx","filename":"document.docx","docx":{"title":"...","sections":[{"heading":"...","paragraphs":["..."]}]}}
Write a real, complete Word document from the user's text. Use clear headings and full paragraphs.`;

function imageErrorMessage(code: string, status: number): string {
  if (code === "no-key" || status === 503)
    return "Image generation needs a Gemini key on the server — none is set yet.";
  if (code === "model-unavailable" || status === 502)
    return "The image model is unavailable for this key right now.";
  if (code === "rate-limited" || status === 429)
    return "Too many image requests — please wait a minute and try again.";
  if (code === "refused") return "That prompt was refused — adult content is not allowed.";
  return `Image generation failed (${status || code}).`;
}

export default function WorkflowsPage() {
  const { t } = useLang();
  const [wfName, setWfName] = useState("My workflow");
  const [wfId, setWfId] = useState<string | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([
    { id: uid(), kind: "input", label: "Input", prompt: "" },
    { id: uid(), kind: "summarise", label: "Summarise", prompt: "in 3 bullet points" },
  ]);
  const [savedWfs, setSavedWfs] = useState<StudioWorkflow[]>([]);
  const [runInput, setRunInput] = useState("");
  const [running, setRunning] = useState(false);
  const [stepResults, setStepResults] = useState<StepResult[]>([]);
  const [finalOutput, setFinalOutput] = useState("");
  const [finalIsImage, setFinalIsImage] = useState(false);
  const [runError, setRunError] = useState("");
  const [history, setHistory] = useState<WorkflowRun[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    // Logged-in users load saved workflows/runs from localStorage;
    // guests work in memory only (refreshAuthMode sets the mode).
    store.refreshAuthMode().then(() => {
      setSavedWfs(store.workflows());
      setHistory(store.runs());
    });
  }, []);

  const updateStep = (id: string, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { id: uid(), kind: "ai", label: "AI step", prompt: "" },
    ]);
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  const deleteStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  };

  const saveWorkflow = () => {
    const name = wfName.trim() || "Untitled workflow";
    if (steps.length === 0) {
      setNotice("Add at least one step before saving.");
      return;
    }
    const list = store.workflows();
    const now = Date.now();
    let next: StudioWorkflow[];
    if (wfId && list.some((w) => w.id === wfId)) {
      next = list.map((w) => (w.id === wfId ? { ...w, name, steps, updatedAt: now } : w));
    } else {
      const created: StudioWorkflow = { id: uid(), name, steps, updatedAt: now };
      next = [created, ...list];
      setWfId(created.id);
    }
    store.saveWorkflows(next);
    setSavedWfs(next);
    setNotice(`Saved workflow "${name}" on this device.`);
  };

  const loadWorkflow = (id: string) => {
    const w = savedWfs.find((x) => x.id === id);
    if (!w) return;
    setWfId(w.id);
    setWfName(w.name);
    setSteps(w.steps);
    setStepResults([]);
    setFinalOutput("");
    setRunError("");
    setNotice(`Loaded workflow "${w.name}".`);
  };

  const deleteWorkflow = (id: string) => {
    if (!window.confirm("Delete this workflow?")) return;
    const next = savedWfs.filter((w) => w.id !== id);
    store.saveWorkflows(next);
    setSavedWfs(next);
    if (wfId === id) {
      setWfId(null);
      setWfName("My workflow");
      setSteps([]);
    }
  };

  const saveRun = (run: WorkflowRun) => {
    const next = [run, ...store.runs()].slice(0, 50);
    store.saveRuns(next);
    setHistory(next);
  };

  const runWorkflow = async () => {
    if (running) return;
    if (steps.length === 0) {
      setNotice("Add at least one step first.");
      return;
    }
    if (!runInput.trim() && !steps.some((s) => s.kind === "input")) {
      setNotice("Type the workflow input text first.");
      return;
    }
    setRunning(true);
    setStepResults([]);
    setFinalOutput("");
    setFinalIsImage(false);
    setRunError("");
    setNotice("");

    const results: StepResult[] = [];
    let current = runInput.trim();
    let failedAt: string | null = null;
    let failMessage = "";

    try {
      for (const step of steps) {
        let output = "";
        let imageUrl: string | undefined;
        let docSpec: FileSpec | undefined;
        try {
          if (step.kind === "input") {
            current = runInput.trim();
            output = current || "(empty input)";
          } else if (step.kind === "image") {
            const hint = step.prompt.trim() ? `, ${step.prompt.trim()}` : "";
            const res = await fetch("/api/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: `${current.slice(0, 900)}${hint}` }),
            });
            if (!res.ok) {
              const j = (await res.json().catch(() => ({}))) as { error?: string };
              throw new Error(imageErrorMessage(j.error ?? "", res.status));
            }
            const j = (await res.json()) as { image?: string };
            if (!j.image) throw new Error("The image service returned no image.");
            imageUrl = j.image;
            current = j.image;
            output = "Image generated.";
          } else if (step.kind === "document") {
            const title = step.prompt.trim() || wfName.trim() || "Document";
            const spec = await chatJson<FileSpec>(
              [
                {
                  role: "user",
                  content: `Document title: ${title}\n\nText to turn into a document:\n${current}`,
                },
              ],
              DOC_SYSTEM,
              "smart"
            );
            if (!spec || spec.type !== "docx" || !spec.docx) throw new Error("bad-docx-spec");
            docSpec = spec;
            output = `Document ready: ${spec.filename}`;
          } else {
            let system = "";
            let user = "";
            // Never send a generated image data URL back to the AI as text.
            const textForAi = current.startsWith("data:image")
              ? "[An image was generated in the previous step.]"
              : current;
            if (step.kind === "ai") {
              system = "You are a helpful AI assistant. Follow the user's instruction exactly and return only the result.";
              user = `${step.prompt.trim() || "Process this text:"}\n\n---\n${textForAi}`;
            } else if (step.kind === "translate") {
              system = "You are a translator. Translate the user's text exactly, preserving meaning and tone. Return only the translation, no explanation.";
              user = `Translate ${step.prompt.trim() || "to Pashto"}:\n\n${textForAi}`;
            } else if (step.kind === "summarise") {
              system = "You are a careful summariser. Summarise clearly and briefly, keeping the key facts.";
              user = `Summarise this text${step.prompt.trim() ? ` (${step.prompt.trim()})` : ""}:\n\n${textForAi}`;
            } else {
              system = "You are a professional writer. Write clearly, with good structure and correct grammar.";
              user = `${step.prompt.trim() || "Write from this text:"}\n\n${textForAi}`;
            }
            const messages: ApiChatMsg[] = [{ role: "user", content: user }];
            const { text, mode } = await chatText(messages, system, "smart");
            if (mode === "offline" || mode === "busy") {
              // The API answered with its own honest note (no key / busy)
              // — treat it as a failure, not as a real result.
              throw new Error(text || "The AI is unavailable right now.");
            }
            if (!text.trim()) throw new Error("The AI returned an empty reply.");
            current = text;
            output = text;
          }
        } catch (e) {
          let msg = e instanceof Error ? e.message : "Step failed.";
          if (/Unexpected token|is not valid JSON/i.test(msg)) {
            msg =
              "The AI is offline or busy right now (no Gemini key on the server, or the model failed) — this step could not produce its result.";
          }
          store.log("studio/workflows", `${step.label}: ${msg}`);
          results.push({ stepId: step.id, label: step.label, kind: step.kind, output: "", status: "error", error: msg });
          setStepResults([...results]);
          failedAt = step.label;
          failMessage = msg;
          break;
        }
        results.push({ stepId: step.id, label: step.label, kind: step.kind, output, imageUrl, docSpec, status: "done" });
        setStepResults([...results]);
      }
    } finally {
      setRunning(false);
    }

    const isImageOutput = steps.length > 0 && results[results.length - 1]?.imageUrl !== undefined && !failedAt;
    const snippet = isImageOutput ? "[image generated]" : current.slice(0, 300);
    saveRun({
      id: uid(),
      workflowId: wfId ?? "",
      workflowName: wfName.trim() || "Untitled workflow",
      input: runInput.trim().slice(0, 300),
      output: failedAt ? "" : snippet,
      error: failedAt ? `Failed at "${failedAt}": ${failMessage}` : undefined,
      ts: Date.now(),
    });
    if (failedAt) {
      setRunError(`Stopped at step "${failedAt}": ${failMessage}`);
    } else {
      setFinalOutput(current);
      setFinalIsImage(isImageOutput);
    }
  };

  const downloadDoc = async (spec: FileSpec) => {
    try {
      await downloadFileSpec(spec);
    } catch (e) {
      store.log("studio/workflows", e instanceof Error ? e.message : "doc download failed");
      setNotice("The document download failed — please try again.");
    }
  };

  const clearHistory = () => {
    if (!window.confirm("Clear all run history?")) return;
    store.saveRuns([]);
    setHistory([]);
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:px-4">
      <header className="space-y-1">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <span aria-hidden className="inline-block rtl:rotate-180">←</span>
          {t("backToChat")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold sm:text-2xl">{t("workflows")}</h1>
          <span className="ms-auto" />
          <Btn size="sm" onClick={saveWorkflow} className={SOLID}>
            Save workflow
          </Btn>
        </div>
        <p className="text-sm text-[var(--muted)]">{t("workflowsSubtitle")}</p>
      </header>

      {notice && (
        <button
          type="button"
          className="w-full rounded-xl bg-amber-500/15 px-3 py-2 text-start text-sm text-amber-600 dark:text-amber-300"
          onClick={() => setNotice("")}
        >
          {notice} ✕
        </button>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Builder */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t("workflowsBuild")}</h2>
          <div className="flex flex-wrap gap-2">
            <Input
              value={wfName}
              onChange={(e) => setWfName(e.target.value)}
              placeholder="Workflow name"
              className="!w-auto flex-1"
            />
            <Select value={wfId ?? ""} onChange={(e) => e.target.value && loadWorkflow(e.target.value)} className="!w-auto">
              <option value="">— Load saved —</option>
              {savedWfs.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} ({w.steps.length} steps)
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            {steps.map((step, idx) => (
              <div key={step.id} className="space-y-2 rounded-xl border border-[var(--card-border)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-xs font-bold text-white">
                    {idx + 1}
                  </span>
                  <Select
                    value={step.kind}
                    onChange={(e) => {
                      const kind = e.target.value as StepKind;
                      updateStep(step.id, {
                        kind,
                        label: STEP_KINDS.find((k) => k.value === kind)?.label ?? kind,
                      });
                    }}
                    className="!w-auto"
                  >
                    {STEP_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    value={step.label}
                    onChange={(e) => updateStep(step.id, { label: e.target.value })}
                    placeholder="Step label"
                    className="!w-auto min-w-0 flex-1"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label="Move up"
                      className="rounded-lg border border-[var(--card-border)] px-2 py-1 text-xs disabled:opacity-40"
                      disabled={idx === 0}
                      onClick={() => moveStep(idx, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      className="rounded-lg border border-[var(--card-border)] px-2 py-1 text-xs disabled:opacity-40"
                      disabled={idx === steps.length - 1}
                      onClick={() => moveStep(idx, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      aria-label="Delete step"
                      className="rounded-lg border border-[var(--card-border)] px-2 py-1 text-xs text-red-500"
                      onClick={() => deleteStep(step.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <Textarea
                  value={step.prompt}
                  onChange={(e) => updateStep(step.id, { prompt: e.target.value })}
                  rows={2}
                  placeholder={STEP_HINTS[step.kind]}
                />
              </div>
            ))}
            {steps.length === 0 && <p className="text-sm text-[var(--muted)]">No steps yet — add one below.</p>}
          </div>
          <Btn size="sm" variant="outline" onClick={addStep}>
            + Add step
          </Btn>

          {/* Saved workflows */}
          <div className="border-t border-[var(--card-border)] pt-3">
            <h3 className="mb-2 text-sm font-bold">{t("workflowsSaved")}</h3>
            <div className="space-y-1">
              {savedWfs.map((w) => (
                <div key={w.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/5">
                  <button type="button" className="min-w-0 flex-1 truncate text-start" onClick={() => loadWorkflow(w.id)}>
                    {w.name} <span className="text-[var(--muted)]">({w.steps.length} steps)</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete workflow"
                    className="rounded px-1.5 text-xs text-red-500 opacity-0 group-hover:opacity-100"
                    onClick={() => deleteWorkflow(w.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {savedWfs.length === 0 && <p className="text-sm text-[var(--muted)]">No saved workflows yet.</p>}
            </div>
          </div>
        </Card>

        {/* Run */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t("workflowsRun")}</h2>
          <Field label="Workflow input">
            <Textarea
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              rows={4}
              placeholder="Paste or type the text this workflow should process…"
            />
          </Field>
          <Btn onClick={runWorkflow} disabled={running} className={SOLID}>
            {running ? "Running…" : "Run workflow"}
          </Btn>
          {running && <Spinner label="Running steps in order…" />}

          {runError && (
            <div className="rounded-xl bg-red-500/15 px-3 py-2 text-sm text-red-600 dark:text-red-300">
              {runError}
            </div>
          )}

          <div className="space-y-2">
            {stepResults.map((r) => (
              <div key={r.stepId} className="rounded-xl border border-[var(--card-border)] p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{r.label}</span>
                  <Badge tone={r.status === "done" ? "green" : "red"}>{r.status === "done" ? "Done" : "Failed"}</Badge>
                  <span className="text-xs text-[var(--muted)]">{r.kind}</span>
                </div>
                {r.status === "error" ? (
                  <p className="text-sm text-red-600 dark:text-red-300">{r.error}</p>
                ) : r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.imageUrl} alt={r.label} className="max-w-full rounded-xl" />
                ) : r.docSpec ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm">{r.output}</span>
                    <Btn size="sm" onClick={() => downloadDoc(r.docSpec!)}>
                      Download .docx
                    </Btn>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{r.output}</p>
                )}
              </div>
            ))}
          </div>

          {finalOutput && !runError && (
            <div className="rounded-xl border border-violet-500/40 p-3">
              <h3 className="mb-2 text-sm font-bold">Final output</h3>
              {finalIsImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={finalOutput} alt="Workflow result" className="max-w-full rounded-xl" />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{finalOutput}</p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Run history */}
      <Card className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold">{t("workflowsHistory")}</h2>
          <span className="ms-auto" />
          <Btn size="sm" variant="danger" onClick={clearHistory} disabled={history.length === 0}>
            Clear history
          </Btn>
        </div>
        <div className="space-y-2">
          {history.map((r) => (
            <div key={r.id} className="rounded-xl border border-[var(--card-border)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{r.workflowName}</span>
                <span className="text-xs text-[var(--muted)]">{new Date(r.ts).toLocaleString()}</span>
                {r.error && <Badge tone="red">Failed</Badge>}
              </div>
              <p className="mt-1 text-[var(--muted)]">
                <span className="font-semibold text-[var(--muted)]">Input:</span> {r.input.slice(0, 120)}
                {r.input.length > 120 ? "…" : ""}
              </p>
              {r.error ? (
                <p className="mt-1 text-red-600 dark:text-red-300">{r.error}</p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap">
                  <span className="font-semibold">Output:</span> {r.output.slice(0, 200)}
                  {r.output.length > 200 ? "…" : ""}
                </p>
              )}
            </div>
          ))}
          {history.length === 0 && <p className="text-sm text-[var(--muted)]">No runs yet.</p>}
        </div>
      </Card>
    </div>
  );
}
