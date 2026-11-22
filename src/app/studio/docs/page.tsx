/**
 * /studio/docs — Document Studio.
 * Three tools in tabs:
 * (a) Summarise / Ask — paste text or upload a .txt/.md file.
 *     PDF / .docx / .xlsx have no parser installed, so an honest
 *     note is shown and pasting is offered instead — nothing is faked.
 * (b) Generate document — the AI returns a strict JSON FileSpec
 *     (docx / xlsx / pdf) which is downloaded as a real file.
 * (c) Convert — re-save text in another format (txt/md/csv/json/html).
 *     JSON is validated by the files API; invalid JSON is reported.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import Link from "next/link";
import { useLang } from "@/lib/i18n";
import { store } from "@/lib/store";
import { chatJson, chatText, downloadFileSpec } from "@/lib/client";
import type { FileSpec, FileType } from "@/lib/filegen";
import { Badge, Btn, Card, Field, Input, Select, Spinner, Textarea } from "@/components/ui";

/** Solid brand button — the shared Btn primary is a gradient; studios use a flat brand colour. */
const SOLID = "!bg-none !bg-[var(--brand2)]";

type Tab = "summarise" | "generate" | "convert";

const MAX_DOC_CHARS = 12000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const PDF_NOTE =
  "PDF text extraction needs a PDF parser — none is installed in this app, so the PDF was not read. Paste the text instead, or upload a .txt/.md file.";
const OFFICE_NOTE =
  "This file type (.docx / .xlsx) needs a document parser — none is installed in this app, so the file was not read. Paste the text instead, or upload a .txt/.md file.";

function truncate(text: string, max = MAX_DOC_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[…document truncated to ${max} characters…]` : text;
}

function safeName(s: string, fallback: string): string {
  const clean = s.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50);
  return clean || fallback;
}

export default function DocsStudioPage() {
  const { t } = useLang();
  // Guests work in memory only (logs included); logged-in users keep logs.
  useEffect(() => {
    void store.refreshAuthMode();
  }, []);
  const [tab, setTab] = useState<Tab>("summarise");

  // (a) Summarise / Ask
  const [docText, setDocText] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileNote, setFileNote] = useState("");
  const [question, setQuestion] = useState("");
  const [docResult, setDocResult] = useState("");
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // (b) Generate document
  const [genTopic, setGenTopic] = useState("");
  const [genType, setGenType] = useState<"docx" | "xlsx" | "pdf">("docx");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState("");

  // (c) Convert
  const [convText, setConvText] = useState("");
  const [fromType, setFromType] = useState<FileType>("txt");
  const [toType, setToType] = useState<FileType>("md");
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState("");
  const [convDone, setConvDone] = useState("");

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setFileNote("");
    setDocError("");
    if (file.size > MAX_UPLOAD_BYTES) {
      setFileNote(t("fileTooLarge"));
      return;
    }
    const name = file.name.toLowerCase();
    setFileName(file.name);
    try {
      if (name.endsWith(".txt") || name.endsWith(".md")) {
        const text = await file.text();
        setDocText(text);
        setFileNote(`Loaded ${file.name} (${text.length.toLocaleString()} characters).`);
      } else if (name.endsWith(".pdf")) {
        setFileNote(PDF_NOTE);
      } else if (name.endsWith(".docx") || name.endsWith(".xlsx") || name.endsWith(".xls")) {
        setFileNote(OFFICE_NOTE);
      } else {
        setFileNote("Only .txt and .md files can be read directly. For PDF / Word / Excel, paste the text instead.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "read failed";
      store.log("studio/docs", msg);
      setDocError(`Could not read the file: ${msg}`);
    }
  };

  const summarise = async () => {
    if (!docText.trim()) {
      setDocError("Paste some text or upload a .txt/.md file first.");
      return;
    }
    setDocLoading(true);
    setDocError("");
    setDocResult("");
    try {
      const { text } = await chatText(
        [{ role: "user", content: `Summarise the following document faithfully, with the key points as bullet points, then a one-paragraph short version. Do not add facts that are not in the document.\n\nDocument:\n${truncate(docText)}` }],
        "Act as a careful researcher. Distinguish verified facts from uncertain claims, say when something is not verified, and never invent sources or citations.",
        "smart"
      );
      setDocResult(text || "The AI returned an empty answer. Please try again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "summarise failed";
      store.log("studio/docs", msg);
      setDocError(`Could not summarise: ${msg}`);
    } finally {
      setDocLoading(false);
    }
  };

  const askDoc = async () => {
    if (!docText.trim()) {
      setDocError("Paste some text or upload a .txt/.md file first.");
      return;
    }
    if (!question.trim()) {
      setDocError("Type a question about the document first.");
      return;
    }
    setDocLoading(true);
    setDocError("");
    setDocResult("");
    try {
      const { text } = await chatText(
        [{ role: "user", content: `Answer this question using ONLY the document below. If the document does not contain the answer, say so clearly — do not guess.\n\nQuestion: ${question.trim()}\n\nDocument:\n${truncate(docText)}` }],
        "Act as a careful researcher. Distinguish verified facts from uncertain claims, say when something is not verified, and never invent sources or citations.",
        "smart"
      );
      setDocResult(text || "The AI returned an empty answer. Please try again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ask failed";
      store.log("studio/docs", msg);
      setDocError(`Could not answer: ${msg}`);
    } finally {
      setDocLoading(false);
    }
  };

  const generateDoc = async () => {
    const topic = genTopic.trim();
    if (!topic) {
      setGenError("Type a topic for the document first.");
      return;
    }
    setGenLoading(true);
    setGenError("");
    try {
      const filename = `${safeName(topic, "document")}.${genType}`;
      const schemas: Record<string, string> = {
        docx: 'Return ONLY this JSON object, no other text: {"type":"docx","filename":"FILENAME","docx":{"title":"TITLE","sections":[{"heading":"HEADING","paragraphs":["PARAGRAPH 1","PARAGRAPH 2"]}]}} — at least 3 sections.',
        xlsx: 'Return ONLY this JSON object, no other text: {"type":"xlsx","filename":"FILENAME","xlsx":{"sheets":[{"name":"SHEET NAME","rows":[["HEADER 1","HEADER 2"],["VALUE 1","VALUE 2"]]}]}} — at least 1 sheet with a header row and at least 5 data rows.',
        pdf: 'Return ONLY this JSON object, no other text: {"type":"pdf","filename":"FILENAME","pdf":{"title":"TITLE","lines":["LINE 1","LINE 2"]}} — at least 10 lines of real content.',
      };
      const spec = await chatJson<FileSpec>(
        [{ role: "user", content: `${schemas[genType]}\n\nTopic: ${topic}` }],
        "You generate real document content as strict JSON. Return ONLY a valid JSON object matching the requested schema — no markdown fences, no explanation, no extra text.",
        "smart"
      );
      // Validate the shape before downloading — a bad spec is reported, never faked.
      const problem = validateGenSpec(spec, genType);
      if (problem) throw new Error(`The AI returned a document that does not match the ${genType} format (${problem}). Please try again.`);
      const fixed: FileSpec = { ...spec, type: genType, filename };
      await downloadFileSpec(fixed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "generate failed";
      store.log("studio/docs", msg);
      setGenError(
        msg.includes("JSON") || msg.includes("Unexpected token")
          ? "The AI returned text that is not valid JSON, so no file was created. Please try again."
          : `Could not generate the document: ${msg}`
      );
    } finally {
      setGenLoading(false);
    }
  };

  const convert = async () => {
    if (!convText.trim()) {
      setConvError("Paste or type some content first.");
      return;
    }
    if (fromType === toType) {
      setConvError("The “from” and “to” formats are the same — pick a different target format.");
      return;
    }
    setConvLoading(true);
    setConvError("");
    setConvDone("");
    try {
      if (toType === "json") {
        try {
          JSON.parse(convText);
        } catch {
          throw new Error("The content is not valid JSON, so it cannot be saved as .json. Fix the JSON and try again.");
        }
      }
      const spec: FileSpec = {
        type: toType,
        filename: `converted.${toType}`,
        content: convText,
      };
      await downloadFileSpec(spec);
      setConvDone(`Downloaded as converted.${toType}.`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "convert failed";
      store.log("studio/docs", msg);
      setConvError(msg.startsWith("The content is not valid JSON") ? msg : `Could not convert: ${msg}`);
    } finally {
      setConvLoading(false);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "summarise", label: t("docsTabSummarise") },
    { id: "generate", label: t("docsTabGenerate") },
    { id: "convert", label: t("docsTabConvert") },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-3 py-4 sm:px-4">
      <header className="space-y-1">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--muted)] hover:text-[var(--foreground)]">
          <Icon name="arrowLeft" size={16} className="inline-block align-middle rtl:rotate-180" />
          {t("backToChat")}
        </Link>
        <h1 className="text-xl font-bold sm:text-2xl">{t("docs")}</h1>
        <p className="text-sm text-[var(--muted)]">{t("docsSubtitle")}</p>
      </header>

      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold ${
              tab === tb.id ? "bg-[var(--brand2)] text-white" : "border border-[var(--card-border)]"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "summarise" && (
        <Card>
          <div className="space-y-4">
            <Field label="Document — upload or paste">
              <div className="flex flex-wrap items-center gap-2">
                <Btn variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  Upload .txt / .md (PDF / Word / Excel: see note)
                </Btn>
                {fileName && <Badge tone="cyan">{fileName}</Badge>}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,.pdf,.docx,.xlsx,.xls,text/plain,text/markdown"
                  className="hidden"
                  onChange={(e) => {
                    void onUpload(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              {fileNote && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{fileNote}</p>}
              <Textarea
                value={docText}
                onChange={(e) => setDocText(e.target.value)}
                rows={10}
                placeholder="Paste your document text here… (up to ~12,000 characters are sent to the AI)"
                className="bidi-plaintext mt-2"
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {docText.length.toLocaleString()} characters — the AI sees the first {MAX_DOC_CHARS.toLocaleString()}.
                PDF, Word (.docx) and Excel (.xlsx) files cannot be read here: no parser is installed, so please paste their text instead.
              </p>
            </Field>

            <div className="flex flex-wrap gap-2">
              <Btn onClick={summarise} disabled={docLoading || !docText.trim()} className={SOLID}>
                Summarise
              </Btn>
              <span className="flex min-w-48 flex-1 gap-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a question about the document…"
                  className="bidi-plaintext"
                />
                <Btn variant="outline" onClick={askDoc} disabled={docLoading || !docText.trim() || !question.trim()}>
                  Ask
                </Btn>
              </span>
            </div>
            {docLoading && <Spinner label="Reading the document…" />}
            {docError && (
              <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{docError}</p>
            )}
            {docResult && (
              <div>
                <h2 className="mb-2 text-base font-bold">Answer</h2>
                <div className="bidi-plaintext whitespace-pre-wrap rounded-xl border border-[var(--card-border)] p-3 text-[15px] leading-relaxed">
                  {docResult}
                </div>
                <div className="mt-2 flex gap-2">
                  <Btn
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(docResult);
                      } catch (e) {
                        store.log("studio/docs", e instanceof Error ? e.message : "copy failed");
                        setDocError("Copy failed — your browser blocked clipboard access.");
                      }
                    }}
                  >
                    {t("copy")}
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "generate" && (
        <Card>
          <div className="space-y-4">
            <Field label="Topic">
              <Input
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                placeholder="e.g. Monthly sales report, or: A guide to growing tomatoes"
                className="bidi-plaintext"
              />
            </Field>
            <Field label="Document type">
              <Select value={genType} onChange={(e) => setGenType(e.target.value as "docx" | "xlsx" | "pdf")}>
                <option value="docx">Word document (.docx)</option>
                <option value="xlsx">Excel spreadsheet (.xlsx)</option>
                <option value="pdf">PDF (.pdf)</option>
              </Select>
            </Field>
            <p className="text-xs text-[var(--muted)]">
              The AI writes the content as a strict JSON document spec, and /api/files builds the real file on the server.
              If the AI returns bad JSON or the wrong shape, no file is created and the error is shown.
            </p>
            <Btn onClick={generateDoc} disabled={genLoading || !genTopic.trim()} className={`w-full ${SOLID}`}>
              {genLoading ? "Generating…" : `${t("generate")} .${genType}`}
            </Btn>
            {genLoading && <Spinner label="The AI is writing your document…" />}
            {genError && (
              <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{genError}</p>
            )}
          </div>
        </Card>
      )}

      {tab === "convert" && (
        <Card>
          <div className="space-y-4">
            <Field label="Your content">
              <Textarea
                value={convText}
                onChange={(e) => setConvText(e.target.value)}
                rows={10}
                placeholder="Paste your text here…"
                className="bidi-plaintext"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <Select value={fromType} onChange={(e) => setFromType(e.target.value as FileType)}>
                  <option value="txt">Text (.txt)</option>
                  <option value="md">Markdown (.md)</option>
                  <option value="csv">CSV (.csv)</option>
                  <option value="json">JSON (.json)</option>
                  <option value="html">HTML (.html)</option>
                </Select>
              </Field>
              <Field label="To">
                <Select value={toType} onChange={(e) => setToType(e.target.value as FileType)}>
                  <option value="txt">Text (.txt)</option>
                  <option value="md">Markdown (.md)</option>
                  <option value="csv">CSV (.csv)</option>
                  <option value="json">JSON (.json)</option>
                  <option value="html">HTML (.html)</option>
                </Select>
              </Field>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Conversion re-saves your text in the chosen format — it does not re-parse structured data.
              JSON is the exception: invalid JSON is rejected with an honest error instead of a broken file.
            </p>
            <Btn onClick={convert} disabled={convLoading || !convText.trim()} className={`w-full ${SOLID}`}>
              {convLoading ? "Converting…" : `Convert to .${toType} & ${t("download")}`}
            </Btn>
            {convLoading && <Spinner label="Converting…" />}
            {convError && (
              <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">{convError}</p>
            )}
            {convDone && (
              <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-300">{convDone}</p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Client-side shape check for a generated document spec. Returns a problem string, or null. */
function validateGenSpec(spec: FileSpec | null | undefined, type: "docx" | "xlsx" | "pdf"): string | null {
  if (!spec || typeof spec !== "object") return "not an object";
  if (type === "docx") {
    const sections = spec.docx?.sections;
    if (!Array.isArray(sections) || sections.length === 0) return "no sections";
    if (!sections.every((s) => Array.isArray(s.paragraphs) && s.paragraphs.length > 0)) return "empty section";
    return null;
  }
  if (type === "xlsx") {
    const sheets = spec.xlsx?.sheets;
    if (!Array.isArray(sheets) || sheets.length === 0) return "no sheets";
    if (!sheets.every((s) => Array.isArray(s.rows) && s.rows.length > 0)) return "empty sheet";
    return null;
  }
  const lines = spec.pdf?.lines;
  if (!Array.isArray(lines) || lines.length === 0) return "no lines";
  return null;
}
