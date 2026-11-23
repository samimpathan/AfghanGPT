/**
 * /studio/builder — Website/App Builder (Lovable-style).
 * Step 1: describe the app → AI returns a complete multi-file web
 * project as strict JSON. Step 2: edit files + live preview
 * (sandboxed iframe). Step 3: modify with words → AI returns the
 * updated files. Save locally, download a real ZIP. Database /
 * Deploy / Auth panels are honest: they store settings locally or
 * link out — nothing pretends to deploy or connect by itself.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import AppShell from "@/components/AppShell";
import { useLang } from "@/lib/i18n";
import { store, uid, type ProjectFile, type StudioProject } from "@/lib/store";
import { chatJson, downloadFileSpec } from "@/lib/client";
import { Btn, Card, Field, Input, Select, Spinner, Textarea, Badge } from "@/components/ui";

type GenSpec = {
  name?: string;
  description?: string;
  files?: { path?: string; content?: string }[];
};

const EXAMPLES = [
  "A todo app with dark mode",
  "A calculator",
  "A personal portfolio",
  "A notes app with search",
  "A Pomodoro timer",
];

const GEN_SYSTEM = `You are a senior front-end engineer. Return ONLY a JSON object with this exact shape, no markdown fences, no explanation:
{"name":"...","description":"...","files":[{"path":"index.html","content":"..."},{"path":"style.css","content":"..."},{"path":"script.js","content":"..."}]}
Rules: build a COMPLETE, self-contained, working multi-file web project. All CSS goes in style.css, all JavaScript in script.js, both linked from index.html. No build step, no npm, no framework CDN that needs compiling. Every button must really work. No placeholder or lorem text — real working features with sensible default content. Keep the total under ~15000 characters.`;

const SB_KEY = "samim-user-supabase";

function buildSrcDoc(files: ProjectFile[]): string | null {
  const html =
    files.find((f) => f.path.toLowerCase() === "index.html") ??
    files.find((f) => f.path.toLowerCase().endsWith(".html"));
  const css = files
    .filter((f) => f.path.toLowerCase().endsWith(".css"))
    .map((f) => f.content)
    .join("\n");
  const js = files
    .filter((f) => f.path.toLowerCase().endsWith(".js"))
    .map((f) => f.content)
    .join("\n");
  if (!html && !css && !js) return null;
  let out =
    html?.content ??
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
  if (css) {
    const style = `<style>\n${css}\n</style>`;
    out = out.includes("</head>") ? out.replace("</head>", `${style}</head>`) : style + out;
  }
  if (js) {
    const script = `<script>\n${js}\n<\/script>`;
    out = out.includes("</body>") ? out.replace("</body>", `${script}</body>`) : out + script;
  }
  return out;
}

function cleanSpec(spec: GenSpec): { name: string; description: string; files: ProjectFile[] } | null {
  const files = (spec.files ?? [])
    .filter((f) => f && typeof f.path === "string" && f.path.trim() && typeof f.content === "string")
    .map((f) => ({ path: f.path!.trim(), content: f.content! }));
  if (files.length === 0) return null;
  return {
    name: typeof spec.name === "string" && spec.name.trim() ? spec.name.trim() : "My app",
    description: typeof spec.description === "string" ? spec.description : "",
    files,
  };
}

export default function BuilderPage() {
  const { t } = useLang();
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [project, setProject] = useState<{ name: string; description: string; files: ProjectFile[] } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [activePath, setActivePath] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [modifyInput, setModifyInput] = useState("");
  const [modifying, setModifying] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<StudioProject[]>([]);
  const [exporting, setExporting] = useState(false);
  const [sbUrl, setSbUrl] = useState("");
  const [sbKey, setSbKey] = useState("");
  const [sbSaved, setSbSaved] = useState(false);

  useEffect(() => {
    // Logged-in users load their saved projects from localStorage;
    // guests work in memory only (refreshAuthMode sets the mode).
    store.refreshAuthMode().then(() => {
      setSaved(store.projects().filter((p) => p.kind === "app"));
    });
    try {
      const raw = window.localStorage.getItem(SB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { url?: string; anonKey?: string };
        if (typeof parsed.url === "string") setSbUrl(parsed.url);
        if (typeof parsed.anonKey === "string") setSbKey(parsed.anonKey);
        if (parsed.url || parsed.anonKey) setSbSaved(true);
      }
    } catch {
      /* no saved connection — fields stay empty */
    }
  }, []);

  const activeFile = useMemo(
    () => project?.files.find((f) => f.path === activePath) ?? null,
    [project, activePath]
  );
  const srcDoc = useMemo(() => (project ? buildSrcDoc(project.files) : null), [project]);

  const updateFileContent = (content: string) => {
    if (!project || !activeFile) return;
    setProject({
      ...project,
      files: project.files.map((f) => (f.path === activeFile.path ? { ...f, content } : f)),
    });
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!project || !name) return;
    if (project.files.some((f) => f.path === name)) {
      setNotice(`A file named "${name}" already exists.`);
      return;
    }
    setProject({ ...project, files: [...project.files, { path: name, content: "" }] });
    setNewFileName("");
    setActivePath(name);
  };

  const deleteFile = (path: string) => {
    if (!project) return;
    if (!window.confirm(`Delete ${path}?`)) return;
    const next = project.files.filter((f) => f.path !== path);
    setProject({ ...project, files: next });
    if (activePath === path) setActivePath(next[0]?.path ?? "");
  };

  const generate = async () => {
    const prompt = description.trim();
    if (!prompt) {
      setNotice("Describe your app first, or tap one of the examples.");
      return;
    }
    setGenerating(true);
    setNotice("");
    try {
      const spec = await chatJson<GenSpec>(
        [{ role: "user", content: `Build this web app:\n${prompt}` }],
        GEN_SYSTEM,
        "smart"
      );
      const cleaned = cleanSpec(spec);
      if (!cleaned) throw new Error("empty-project");
      setProject(cleaned);
      setProjectId(null);
      setActivePath(cleaned.files.find((f) => f.path === "index.html")?.path ?? cleaned.files[0].path);
    } catch (e) {
      store.log("studio/builder", e instanceof Error ? e.message : "generate failed");
      setNotice(
        "The app could not be generated — the AI is offline or busy right now. Nothing was faked; please try again later."
      );
    } finally {
      setGenerating(false);
    }
  };

  const modify = async () => {
    const change = modifyInput.trim();
    if (!project || !change) {
      setNotice("Type a change first, e.g. “add a dark-mode toggle”.");
      return;
    }
    setModifying(true);
    setNotice("");
    try {
      const spec = await chatJson<GenSpec>(
        [
          {
            role: "user",
            content: `Current project files (JSON):\n${JSON.stringify(project.files)}\n\nChange request: ${change}\n\nReturn the FULL updated project in the same JSON shape — include EVERY file (changed and unchanged).`,
          },
        ],
        GEN_SYSTEM,
        "smart"
      );
      const cleaned = cleanSpec(spec);
      if (!cleaned) throw new Error("empty-project");
      setProject({ ...cleaned, name: project.name, description: cleaned.description || project.description });
      setModifyInput("");
      setNotice("Changes applied — check the preview.");
    } catch (e) {
      store.log("studio/builder", e instanceof Error ? e.message : "modify failed");
      setNotice(
        "The change could not be applied — the AI is offline or busy right now. Your current files were not changed."
      );
    } finally {
      setModifying(false);
    }
  };

  const saveProject = () => {
    if (!project) return;
    const list = store.projects();
    const now = Date.now();
    let next: StudioProject[];
    if (projectId && list.some((p) => p.id === projectId)) {
      next = list.map((p) =>
        p.id === projectId
          ? { ...p, name: project.name, description: project.description, files: project.files, updatedAt: now }
          : p
      );
    } else {
      const created: StudioProject = {
        id: uid(),
        name: project.name,
        kind: "app",
        description: project.description,
        files: project.files,
        updatedAt: now,
      };
      next = [created, ...list];
      setProjectId(created.id);
    }
    store.saveProjects(next);
    setSaved(next.filter((p) => p.kind === "app"));
    setNotice(`Saved "${project.name}" on this device.`);
  };

  const loadProject = (id: string) => {
    const p = saved.find((x) => x.id === id);
    if (!p) return;
    setProject({ name: p.name, description: p.description, files: p.files });
    setProjectId(p.id);
    setActivePath(p.files.find((f) => f.path === "index.html")?.path ?? p.files[0]?.path ?? "");
    setNotice(`Loaded "${p.name}".`);
  };

  const exportZip = async () => {
    if (!project || project.files.length === 0) {
      setNotice("Generate or load an app first.");
      return;
    }
    setExporting(true);
    try {
      await downloadFileSpec({
        type: "zip",
        filename: `${project.name.replace(/[^\w\-]+/g, "_") || "app"}.zip`,
        files: project.files.map((f) => ({ name: f.path, content: f.content })),
      });
    } catch (e) {
      store.log("studio/builder", e instanceof Error ? e.message : "zip failed");
      setNotice("The ZIP download failed — please try again.");
    } finally {
      setExporting(false);
    }
  };

  const saveSupabase = () => {
    try {
      window.localStorage.setItem(SB_KEY, JSON.stringify({ url: sbUrl.trim(), anonKey: sbKey.trim() }));
      setSbSaved(true);
      setNotice("Supabase settings saved on this device only.");
    } catch {
      setNotice("Could not save — browser storage is unavailable.");
    }
  };

  return (
    <AppShell title={t("builder")} subtitle={t("builderSubtitle")} icon="layers" wide>
      <div className="space-y-4">
      {project && (
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="outline" onClick={exportZip} disabled={exporting}>
            {exporting ? "Exporting…" : "Download ZIP"}
          </Btn>
          <Btn size="sm" onClick={saveProject}>
            {t("save")}
          </Btn>
        </div>
      )}

      {notice && (
        <button
          type="button"
          className="w-full rounded-xl bg-amber-500/15 px-3 py-2 text-start text-sm text-amber-600 dark:text-amber-300"
          onClick={() => setNotice("")}
        >
          {notice} <Icon name="x" size={13} className="ms-1 inline-block align-middle" />
        </button>
      )}

      {/* Step 1 — describe */}
      <Card className="space-y-3">
        <h2 className="text-sm font-bold">{t("builderStep1")}</h2>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe your app… e.g. A todo app with dark mode and categories"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="rounded-full border border-[var(--card-border)] px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/5"
              onClick={() => setDescription(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={generate} disabled={generating}>
            {generating ? "Generating…" : "Generate app"}
          </Btn>
          {generating && <Spinner label="The AI is building your files…" />}
          <span className="ms-auto" />
          <Field label="Load a saved app">
            <Select value={projectId ?? ""} onChange={(e) => e.target.value && loadProject(e.target.value)} className="!w-auto">
              <option value="">— Choose an app —</option>
              {saved.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({new Date(p.updatedAt).toLocaleDateString()})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {!project && !generating && (
        <Card className="flex flex-col items-center gap-2 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--brand2)]/10 text-[var(--brand2)]">
            <Icon name="layers" size={24} />
          </span>
          <p className="text-sm text-[var(--muted)]">{t("empty")}</p>
        </Card>
      )}

      {project && (
        <>
          {/* Step 2 — edit + preview */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold">{t("builderStep2")}</h2>
              <span className="text-sm text-[var(--muted)]">{project.name}</span>
              {project.description && <Badge tone="cyan">{project.description.slice(0, 60)}</Badge>}
            </div>
            <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="space-y-2">
                {project.files.map((f) => (
                  <div
                    key={f.path}
                    className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
                      f.path === activePath ? "bg-[var(--brand2)]/10" : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <button type="button" className="min-w-0 flex-1 truncate text-start font-mono" onClick={() => setActivePath(f.path)}>
                      {f.path}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="rounded px-1 text-xs text-red-500 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      onClick={() => deleteFile(f.path)}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="new file, e.g. about.html" className="font-mono" />
                  <Btn size="sm" variant="outline" onClick={addFile}>
                    + Add
                  </Btn>
                </div>
              </div>
              <div className="space-y-2">
                {activeFile ? (
                  <>
                    <p className="font-mono text-sm font-semibold">{activeFile.path}</p>
                    <Textarea
                      dir="ltr"
                      value={activeFile.content}
                      onChange={(e) => updateFileContent(e.target.value)}
                      rows={14}
                      spellCheck={false}
                      className="!font-mono !text-[13px] !leading-6"
                    />
                  </>
                ) : (
                  <p className="py-8 text-center text-sm text-[var(--muted)]">Pick a file to edit.</p>
                )}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold">Live preview</h3>
              {srcDoc ? (
                <iframe
                  title="App preview"
                  sandbox="allow-scripts"
                  srcDoc={srcDoc}
                  className="h-[480px] w-full rounded-xl border border-[var(--card-border)] bg-white"
                />
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  Preview works for web projects only (HTML / CSS / JavaScript). This project has no web
                  files yet.
                </p>
              )}
            </div>
          </Card>

          {/* Step 3 — modify with words */}
          <Card className="space-y-3">
            <h2 className="text-sm font-bold">{t("builderStep3")}</h2>
            <div className="flex gap-2">
              <Input
                value={modifyInput}
                onChange={(e) => setModifyInput(e.target.value)}
                placeholder="e.g. Add a dark-mode toggle and a search box"
                className="min-w-0 flex-1"
              />
              <Btn onClick={modify} disabled={modifying} className="shrink-0">
                {modifying ? "Applying…" : "Apply change"}
              </Btn>
            </div>
            {modifying && <Spinner label="The AI is updating your files…" />}
            <p className="text-xs text-[var(--muted)]">
              The AI rewrites the whole project and returns every file — changed and unchanged — then the
              preview updates.
            </p>
          </Card>
        </>
      )}

      {/* Honest panels */}
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">Database</h2>
          <p className="text-xs text-[var(--muted)]">
            Your Supabase connection is stored only in this browser. The preview does not use it yet —
            it is a per-project setting you wire in yourself.
          </p>
          <Field label="Supabase URL">
            <Input value={sbUrl} onChange={(e) => setSbUrl(e.target.value)} placeholder="https://xyz.supabase.co" dir="ltr" />
          </Field>
          <Field label="Supabase anon key">
            <Input value={sbKey} onChange={(e) => setSbKey(e.target.value)} placeholder="eyJhbGciOi…" dir="ltr" type="password" />
          </Field>
          <Btn size="sm" variant="outline" onClick={saveSupabase}>
            Save connection
          </Btn>
          {sbSaved && (
            <p className="text-xs text-emerald-600 dark:text-emerald-300">
              Connected (local settings saved — the app preview does not use it yet).
            </p>
          )}
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-bold">Deploy</h2>
          <p className="text-xs text-[var(--muted)]">
            This studio does not deploy for you — there is no fake “Deploy now” button. To publish:
          </p>
          <ol className="list-decimal space-y-1 ps-5 text-xs">
            <li>Download the ZIP and extract its files.</li>
            <li>Push the files to a GitHub repository.</li>
            <li>Open Vercel, click “Add New → Project”, import the repo and deploy.</li>
          </ol>
          <a
            href="https://vercel.com/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand2)] px-4 py-2.5 text-sm font-semibold text-white transition active:scale-95"
          >
            Open Vercel <Icon name="external" size={14} className="ms-1 inline-block align-middle" />
          </a>
        </Card>

        <Card className="space-y-3">
          <h2 className="text-sm font-bold">Auth</h2>
          <p className="text-xs text-[var(--muted)]">
            Sign-in is not automatic. Each generated app is a static web project — user accounts need
            Supabase Auth wired per project (client + tables + policies), which this builder does not
            do for you yet.
          </p>
          <a
            href="https://supabase.com/docs/guides/auth"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-[var(--brand2)] underline"
          >
            Supabase Auth docs <Icon name="external" size={14} className="ms-1 inline-block align-middle" />
          </a>
        </Card>
      </div>
      </div>
    </AppShell>
  );
}
