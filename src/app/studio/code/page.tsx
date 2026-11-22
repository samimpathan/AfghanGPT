/**
 * /studio/code — Coding Studio.
 * Multi-file editor with AI explain / generate / bug-find / optimise,
 * a real web preview (sandboxed iframe, HTML+CSS+JS only — never a
 * fake run), local save/load and a real ZIP export. Non-web languages
 * show an honest note + a link to the DevConnect playground instead
 * of pretending to run in the browser.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { store, uid, type ProjectFile, type StudioProject } from "@/lib/store";
import { chatText, downloadFileSpec } from "@/lib/client";
import Markdown from "@/components/Markdown";
import { Btn, Card, Field, Input, Select, Spinner, Textarea, Badge } from "@/components/ui";

const LANGS = [
  "HTML",
  "CSS",
  "JavaScript",
  "TypeScript",
  "React",
  "Python",
  "PHP",
  "Java",
  "C++",
  "SQL",
] as const;

const WEB_LANGS = ["HTML", "CSS", "JavaScript"];

const EXT_FOR_LANG: Record<string, string> = {
  HTML: "html",
  CSS: "css",
  JavaScript: "js",
  TypeScript: "ts",
  React: "tsx",
  Python: "py",
  PHP: "php",
  Java: "java",
  "C++": "cpp",
  SQL: "sql",
};

const STARTER: ProjectFile[] = [
  {
    path: "index.html",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My App</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<h1>Hello from Samim AI</h1>
<p id="msg">Click the button:</p>
<button onclick="sayHello()">Say hello</button>
<script src="script.js"></script>
</body>
</html>
`,
  },
  {
    path: "style.css",
    content: `body { font-family: system-ui, sans-serif; padding: 24px; background: #0d1426; color: #eaf2ff; }
button { padding: 10px 18px; border: none; border-radius: 10px; background: #2457ff; color: #fff; font-weight: 600; cursor: pointer; }
`,
  },
  {
    path: "script.js",
    content: `function sayHello() {
  document.getElementById("msg").textContent = "Hello! Your preview works.";
}
`,
  },
];

function langForPath(path: string): string {
  const p = path.toLowerCase();
  if (p.endsWith(".html") || p.endsWith(".htm")) return "HTML";
  if (p.endsWith(".css")) return "CSS";
  if (p.endsWith(".js") || p.endsWith(".mjs")) return "JavaScript";
  if (p.endsWith(".ts")) return "TypeScript";
  if (p.endsWith(".tsx") || p.endsWith(".jsx")) return "React";
  if (p.endsWith(".py")) return "Python";
  if (p.endsWith(".php")) return "PHP";
  if (p.endsWith(".java")) return "Java";
  if (p.endsWith(".cpp") || p.endsWith(".c") || p.endsWith(".cc") || p.endsWith(".h")) return "C++";
  if (p.endsWith(".sql")) return "SQL";
  return "JavaScript";
}

/** Strip ``` fences the AI sometimes wraps code in. */
function stripFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-zA-Z0-9+#-]*\s*\n?/, "").replace(/\n?```\s*$/, "");
  return t.trim();
}

/** Build a preview document from web files: inline every .css as
 * <style> and every .js as <script>. Returns null when there is no
 * web file at all — the caller shows the honest note instead. */
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

/** Solid brand button — the shared Btn primary is a gradient; studios use a flat brand colour. */
const SOLID = "!bg-none !bg-[var(--brand2)]";

type AiAction = "explain" | "generate" | "bugs" | "optimise";

export default function CodeStudioPage() {
  const { t } = useLang();
  const [projectName, setProjectName] = useState("My project");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>(STARTER);
  const [openTabs, setOpenTabs] = useState<string[]>(["index.html"]);
  const [activePath, setActivePath] = useState("index.html");
  const [newFileName, setNewFileName] = useState("");
  const [newFileLang, setNewFileLang] = useState<string>("JavaScript");
  const [langOverrides, setLangOverrides] = useState<Record<string, string>>({});
  const [genPrompt, setGenPrompt] = useState("");
  const [aiResult, setAiResult] = useState<{ title: string; text: string; mode: string } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiAction, setAiAction] = useState<AiAction | null>(null);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<StudioProject[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    // Logged-in users load their saved projects from localStorage;
    // guests work in memory only (refreshAuthMode sets the mode).
    store.refreshAuthMode().then(() => {
      setSaved(store.projects().filter((p) => p.kind === "code"));
    });
  }, []);

  const activeFile = useMemo(
    () => files.find((f) => f.path === activePath) ?? null,
    [files, activePath]
  );
  const activeLang = activeFile
    ? langOverrides[activeFile.path] ?? langForPath(activeFile.path)
    : newFileLang;
  const srcDoc = useMemo(() => buildSrcDoc(files), [files]);
  const hasWebFile = srcDoc !== null;

  const openFile = (path: string) => {
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
  };

  const closeTab = (path: string) => {
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (activePath === path) setActivePath(next[next.length - 1] ?? files[0]?.path ?? "");
      return next;
    });
  };

  const updateActiveContent = (content: string) => {
    if (!activeFile) return;
    setFiles((prev) => prev.map((f) => (f.path === activeFile.path ? { ...f, content } : f)));
  };

  const addFile = () => {
    const name = newFileName.trim();
    if (!name) {
      setNotice("Type a file name first, e.g. main.js");
      return;
    }
    if (files.some((f) => f.path === name)) {
      setNotice(`A file named "${name}" already exists.`);
      return;
    }
    const file: ProjectFile = { path: name, content: "" };
    setFiles((prev) => [...prev, file]);
    setLangOverrides((prev) => ({ ...prev, [name]: newFileLang }));
    setNewFileName("");
    openFile(name);
  };

  const renameFile = (path: string) => {
    const next = window.prompt("Rename file", path);
    if (next === null) return;
    const name = next.trim();
    if (!name || name === path) return;
    if (files.some((f) => f.path === name)) {
      setNotice(`A file named "${name}" already exists.`);
      return;
    }
    setFiles((prev) => prev.map((f) => (f.path === path ? { ...f, path: name } : f)));
    setOpenTabs((prev) => prev.map((p) => (p === path ? name : p)));
    if (activePath === path) setActivePath(name);
    setLangOverrides((prev) => {
      const { [path]: old, ...rest } = prev;
      return old ? { ...rest, [name]: old } : rest;
    });
  };

  const deleteFile = (path: string) => {
    if (!window.confirm(`Delete ${path}?`)) return;
    setFiles((prev) => prev.filter((f) => f.path !== path));
    setOpenTabs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (activePath === path) setActivePath(next[next.length - 1] ?? "");
      return next;
    });
  };

  const runAi = async (action: AiAction) => {
    if (aiBusy) return;
    const file = activeFile;
    if (action !== "generate" && !file) {
      setNotice("Open a file first.");
      return;
    }
    if (action === "generate" && !genPrompt.trim() && !file) {
      setNotice("Describe the code to generate, or open a file first.");
      return;
    }
    setAiBusy(true);
    setAiAction(action);
    setNotice("");
    try {
      const lang = file ? activeLang : newFileLang;
      let system = "";
      let user = "";
      if (action === "explain") {
        system = "You are a senior software engineer. Explain code clearly, step by step, in simple language.";
        user = `Explain this ${lang} code:\n\n\`\`\`${lang.toLowerCase()}\n${file!.content}\n\`\`\``;
      } else if (action === "bugs") {
        system = "You are a senior software engineer. Find real bugs, edge cases and security issues. List each bug with the line and the fix. If there are no bugs, say so honestly.";
        user = `Find the bugs in this ${lang} code:\n\n\`\`\`${lang.toLowerCase()}\n${file!.content}\n\`\`\``;
      } else if (action === "optimise") {
        system = "You are a senior software engineer. Return ONLY the optimised version of the code, with no explanation and no markdown fences.";
        user = `Optimise this ${lang} code (keep the same behaviour, make it faster/cleaner):\n\n${file!.content}`;
      } else {
        system = "You are a senior software engineer. Return ONLY the requested code, complete and runnable, with no explanation and no markdown fences.";
        const ctx = file ? `The current file is ${file.path} (${lang}):\n\n${file.content}\n\n` : "";
        user = `${ctx}Write this code in ${lang}:\n${genPrompt.trim() || "Complete and improve the current file."}`;
      }
      const { text, mode } = await chatText([{ role: "user", content: user }], system, "smart");
      const title =
        action === "explain"
          ? "Explanation"
          : action === "bugs"
            ? "Bug check"
            : action === "optimise"
              ? "Optimised code"
              : "Generated code";
      setAiResult({ title, text, mode });
      if (action === "generate") {
        const code = stripFences(text);
        if (code) {
          if (file) {
            updateActiveContent(code);
          } else {
            const path = `main.${EXT_FOR_LANG[lang] ?? "js"}`;
            const created: ProjectFile = { path, content: code };
            setFiles((prev) => [...prev, created]);
            setLangOverrides((prev) => ({ ...prev, [path]: lang }));
            openFile(path);
          }
        }
      }
    } catch (e) {
      store.log("studio/code", e instanceof Error ? e.message : "ai failed");
      setNotice("The AI request failed — please try again in a moment. Nothing was changed.");
    } finally {
      setAiBusy(false);
      setAiAction(null);
    }
  };

  const applyOptimised = () => {
    if (!activeFile || !aiResult) return;
    updateActiveContent(stripFences(aiResult.text));
    setNotice("Optimised code applied to the active file.");
  };

  const saveProject = () => {
    const name = projectName.trim() || "Untitled project";
    const list = store.projects();
    const now = Date.now();
    let next: StudioProject[];
    if (projectId && list.some((p) => p.id === projectId)) {
      next = list.map((p) =>
        p.id === projectId ? { ...p, name, files, updatedAt: now } : p
      );
    } else {
      const created: StudioProject = {
        id: uid(),
        name,
        kind: "code",
        description: "",
        files,
        updatedAt: now,
      };
      next = [created, ...list];
      setProjectId(created.id);
    }
    store.saveProjects(next);
    setSaved(next.filter((p) => p.kind === "code"));
    setNotice(`Saved "${name}" on this device.`);
  };

  const loadProject = (id: string) => {
    const p = saved.find((x) => x.id === id);
    if (!p) return;
    setProjectId(p.id);
    setProjectName(p.name);
    setFiles(p.files.length > 0 ? p.files : STARTER);
    setOpenTabs(p.files.map((f) => f.path));
    setActivePath(p.files[0]?.path ?? "");
    setAiResult(null);
    setNotice(`Loaded "${p.name}".`);
  };

  const exportZip = async () => {
    if (files.length === 0) {
      setNotice("There are no files to export yet.");
      return;
    }
    setExporting(true);
    try {
      await downloadFileSpec({
        type: "zip",
        filename: `${projectName.trim() || "project"}.zip`,
        files: files.map((f) => ({ name: f.path, content: f.content })),
      });
    } catch (e) {
      store.log("studio/code", e instanceof Error ? e.message : "zip failed");
      setNotice("The ZIP export failed — please try again.");
    } finally {
      setExporting(false);
    }
  };

  const nonWebNote = activeFile && !WEB_LANGS.includes(activeLang) && !hasWebFile;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:px-4">
      <header className="space-y-1">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <span aria-hidden className="inline-block rtl:rotate-180">←</span>
          {t("backToChat")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold sm:text-2xl">{t("coding")}</h1>
          <span className="ms-auto" />
          <Btn size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)} disabled={!hasWebFile}>
            {showPreview ? "Hide preview" : "Live Preview"}
          </Btn>
          <Btn size="sm" variant="outline" onClick={exportZip} disabled={exporting}>
            {exporting ? "Exporting…" : "Export ZIP"}
          </Btn>
          <Btn size="sm" onClick={saveProject} className={SOLID}>
            {t("save")}
          </Btn>
        </div>
        <p className="text-sm text-[var(--muted)]">{t("codeSubtitle")}</p>
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

      <Card className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Project name">
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="My project" />
          </Field>
          <Field label="Load a saved project">
            <Select value={projectId ?? ""} onChange={(e) => e.target.value && loadProject(e.target.value)}>
              <option value="">— Choose a project —</option>
              {saved.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({new Date(p.updatedAt).toLocaleDateString()})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* File tree */}
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t("codeFiles")}</h2>
          <div className="space-y-1">
            {files.map((f) => (
              <div
                key={f.path}
                className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${
                  f.path === activePath ? "bg-violet-600/15" : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <button type="button" className="min-w-0 flex-1 truncate text-start font-mono" onClick={() => openFile(f.path)}>
                  {f.path}
                </button>
                <button
                  type="button"
                  aria-label="Rename"
                  className="rounded px-1 text-xs opacity-0 group-hover:opacity-100"
                  onClick={() => renameFile(f.path)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  className="rounded px-1 text-xs text-red-500 opacity-0 group-hover:opacity-100"
                  onClick={() => deleteFile(f.path)}
                >
                  ✕
                </button>
              </div>
            ))}
            {files.length === 0 && <p className="text-sm text-[var(--muted)]">No files yet — add one below.</p>}
          </div>
          <div className="flex gap-2">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="e.g. main.py"
              className="font-mono"
            />
            <Btn size="sm" variant="outline" onClick={addFile}>
              + Add
            </Btn>
          </div>
          <Field label="Language for a new file">
            <Select value={newFileLang} onChange={(e) => setNewFileLang(e.target.value)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </Card>

        {/* Editor */}
        <Card className="space-y-3">
          {openTabs.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {openTabs.map((p) => (
                <span
                  key={p}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-mono ${
                    p === activePath ? "bg-violet-600 text-white" : "border border-[var(--card-border)]"
                  }`}
                >
                  <button type="button" onClick={() => setActivePath(p)}>
                    {p}
                  </button>
                  <button type="button" aria-label="Close tab" onClick={() => closeTab(p)}>
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {activeFile ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{activeFile.path}</span>
                <span className="ms-auto" />
                <Select
                  value={activeLang}
                  onChange={(e) => setLangOverrides((prev) => ({ ...prev, [activeFile.path]: e.target.value }))}
                  className="!w-auto"
                >
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </div>
              <Textarea
                dir="ltr"
                value={activeFile.content}
                onChange={(e) => updateActiveContent(e.target.value)}
                rows={16}
                spellCheck={false}
                placeholder={`Write your ${activeLang} code here…`}
                className="!font-mono !text-[13px] !leading-6"
              />
              {nonWebNote && (
                <div className="rounded-xl border border-[var(--card-border)] bg-amber-500/10 px-3 py-2 text-sm">
                  <p className="font-semibold">Running {activeLang} needs an external runner.</p>
                  <p className="text-[var(--muted)]">
                    This browser preview only runs web code (HTML / CSS / JavaScript). {activeLang} code
                    cannot be executed here — nothing is faked. You can run it in the DevConnect
                    playground instead:{" "}
                    <a
                      className="font-semibold text-violet-500 underline"
                      href="https://dev-connect-nu-wine.vercel.app/playground"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open DevConnect playground
                    </a>
                  </p>
                </div>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-sm text-[var(--muted)]">
              No file open — pick a file from the list or add a new one.
            </p>
          )}

          {/* AI actions */}
          <div className="space-y-2 border-t border-[var(--card-border)] pt-3">
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" variant="outline" onClick={() => runAi("explain")} disabled={aiBusy || !activeFile}>
                {t("codeExplain")}
              </Btn>
              <Btn size="sm" variant="outline" onClick={() => runAi("bugs")} disabled={aiBusy || !activeFile}>
                {t("codeFindBugs")}
              </Btn>
              <Btn size="sm" variant="outline" onClick={() => runAi("optimise")} disabled={aiBusy || !activeFile}>
                {t("codeOptimise")}
              </Btn>
            </div>
            <div className="flex gap-2">
              <Input
                value={genPrompt}
                onChange={(e) => setGenPrompt(e.target.value)}
                placeholder="Describe code to generate, e.g. a function that sorts numbers…"
                className="min-w-0 flex-1"
              />
              <Btn size="sm" onClick={() => runAi("generate")} disabled={aiBusy} className={`shrink-0 ${SOLID}`}>
                {t("codeGenerateCode")}
              </Btn>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Generate replaces the active file (or creates one if none is open). Optimise shows the
              result below — apply it only if you like it.
            </p>
            {aiBusy && <Spinner label={`AI is working (${aiAction})…`} />}
            {aiResult && (
              <div className="rounded-xl border border-[var(--card-border)] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{aiResult.title}</span>
                  {aiResult.mode && <Badge tone={aiResult.mode === "gemini" ? "green" : "amber"}>{aiResult.mode}</Badge>}
                  {aiAction === null && aiResult.title === "Optimised code" && (
                    <Btn size="sm" className={`ms-auto ${SOLID}`} onClick={applyOptimised}>
                      Apply to file
                    </Btn>
                  )}
                </div>
                <Markdown text={aiResult.text} />
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Live preview */}
      {showPreview && (
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">{t("codeLivePreview")}</h2>
          {srcDoc ? (
            <iframe
              title="Live preview"
              sandbox="allow-scripts"
              srcDoc={srcDoc}
              className="h-[480px] w-full rounded-xl border border-[var(--card-border)] bg-white"
            />
          ) : (
            <p className="text-sm text-[var(--muted)]">
              Preview works for web projects only (HTML / CSS / JavaScript). Add an index.html, a .css
              or a .js file to see a live preview here — other languages cannot run in the browser.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
