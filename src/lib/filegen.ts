/**
 * lib/filegen.ts — REAL server-side file generation (v3.2).
 * Runs server-side ONLY (Node) — never in the client bundle.
 * Types: docx, xlsx, pptx, pdf, txt, md, csv, json, html, zip.
 * Every spec is validated and capped before generation; filenames
 * are sanitised (no path traversal). No API key is needed to
 * generate a file — only to ask Gemini to write its content.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { jsPDF } from "jspdf";

export type FileType =
  | "docx"
  | "xlsx"
  | "pptx"
  | "pdf"
  | "txt"
  | "md"
  | "csv"
  | "json"
  | "html"
  | "zip";

export type FileSpec = {
  type: FileType;
  filename: string;
  /** docx: { title, sections: [{ heading, paragraphs[], table? }] } */
  docx?: {
    title?: string;
    sections?: { heading?: string; paragraphs?: string[]; table?: string[][] }[];
  };
  /** xlsx: { sheets: [{ name, rows: [][] }] } */
  xlsx?: { sheets?: { name?: string; rows?: (string | number)[][] }[] };
  /** pptx: { title, slides: [{ title, bullets[], notes? }], theme?: { bg, accent, text } } */
  pptx?: {
    title?: string;
    slides?: { title?: string; bullets?: string[]; notes?: string }[];
    theme?: { bg?: string; accent?: string; text?: string };
  };
  /** pdf: { title, lines[] } */
  pdf?: { title?: string; lines?: string[] };
  /** txt/md/csv/json/html: raw text content */
  content?: string;
  /** zip: [{ name, content }] — text files only */
  files?: { name?: string; content?: string }[];
};

const MAX_SLIDES = 200;
const MAX_ROWS = 200;
const MAX_COLS = 50;
const MAX_TEXT_LEN = 200_000;
const MAX_ZIP_FILES = 50;
const MAX_ZIP_FILE_LEN = 200_000;

/** Strip directories, control chars and unsafe characters. */
export function sanitizeFilename(name: string, fallback: string): string {
  const base = String(name || "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[<>:"|?*\x00-\x1f]/g, "")
    .trim();
  const clean = base || fallback;
  return clean.length > 120 ? clean.slice(0, 120) : clean;
}

function asStr(v: unknown, max = 5000): string {
  return typeof v === "string" ? v.slice(0, max) : v == null ? "" : String(v).slice(0, max);
}

function asRows(rows: unknown): (string | number)[][] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_ROWS).map((r) =>
    (Array.isArray(r) ? r : [r]).slice(0, MAX_COLS).map((c) =>
      typeof c === "number" && Number.isFinite(c) ? c : asStr(c, 500)
    )
  );
}

const MIME: Record<FileType, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  zip: "application/zip",
};

const EXT: Record<FileType, string> = {
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
  pdf: "pdf",
  txt: "txt",
  md: "md",
  csv: "csv",
  json: "json",
  html: "html",
  zip: "zip",
};

export function contentTypeFor(type: FileType): string {
  return MIME[type];
}

export function filenameFor(spec: FileSpec): string {
  const ext = EXT[spec.type];
  const raw = sanitizeFilename(spec.filename, `samim-ai-file.${ext}`);
  return raw.toLowerCase().endsWith(`.${ext}`) ? raw : `${raw}.${ext}`;
}

/** Validate a spec; returns an error string, or null when it is fine. */
export function validateSpec(spec: FileSpec): string | null {
  if (!spec || typeof spec !== "object") return "bad-spec";
  if (!Object.prototype.hasOwnProperty.call(MIME, spec.type)) return "bad-type";
  if (spec.type === "docx") {
    const sections = spec.docx?.sections ?? [];
    if (!Array.isArray(sections) || sections.length === 0 || sections.length > 100)
      return "bad-docx";
  }
  if (spec.type === "xlsx") {
    const sheets = spec.xlsx?.sheets ?? [];
    if (!Array.isArray(sheets) || sheets.length === 0 || sheets.length > 20)
      return "bad-xlsx";
  }
  if (spec.type === "pptx") {
    const slides = spec.pptx?.slides ?? [];
    if (!Array.isArray(slides) || slides.length === 0 || slides.length > MAX_SLIDES)
      return "bad-pptx";
  }
  if (spec.type === "pdf") {
    const lines = spec.pdf?.lines ?? [];
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 2000)
      return "bad-pdf";
  }
  if (spec.type === "zip") {
    const files = spec.files ?? [];
    if (!Array.isArray(files) || files.length === 0 || files.length > MAX_ZIP_FILES)
      return "bad-zip";
    for (const f of files) {
      if (!f || typeof f.content !== "string" || f.content.length > MAX_ZIP_FILE_LEN)
        return "bad-zip-file";
    }
  }
  if (["txt", "md", "csv", "json", "html"].includes(spec.type)) {
    if (typeof spec.content !== "string" || spec.content.length === 0 || spec.content.length > MAX_TEXT_LEN)
      return "bad-content";
    if (spec.type === "json") {
      try {
        JSON.parse(spec.content);
      } catch {
        return "bad-json";
      }
    }
  }
  return null;
}

async function buildDocx(spec: FileSpec): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  const title = asStr(spec.docx?.title, 200);
  if (title) {
    children.push(
      new Paragraph({ text: title, heading: HeadingLevel.TITLE })
    );
  }
  for (const s of spec.docx?.sections ?? []) {
    if (s.heading) {
      children.push(
        new Paragraph({ text: asStr(s.heading, 300), heading: HeadingLevel.HEADING_1 })
      );
    }
    for (const p of s.paragraphs ?? []) {
      children.push(new Paragraph({ children: [new TextRun(asStr(p))] }));
    }
    const table = s.table;
    if (Array.isArray(table) && table.length > 0) {
      const rows = asRows(table).map(
        (r) =>
          new TableRow({
            children: r.map(
              (c) =>
                new TableCell({
                  children: [new Paragraph(String(c))],
                  width: { size: 100, type: WidthType.PERCENTAGE },
                })
            ),
          })
      );
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}

async function buildXlsx(spec: FileSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Samim AI";
  for (const sheet of spec.xlsx?.sheets ?? []) {
    const ws = wb.addWorksheet(sanitizeFilename(sheet.name ?? "Sheet1", "Sheet1").slice(0, 31));
    for (const row of asRows(sheet.rows)) ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

async function buildPptx(spec: FileSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = "Samim AI";
  pptx.title = asStr(spec.pptx?.title, 200) || "Samim AI Presentation";
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  // Theme (from the Presentation Maker): defaults match Samim AI's
  // dark palette, so files made without a theme look exactly as before.
  const bg = (spec.pptx?.theme?.bg ?? "#0D1426").replace(/^#/, "");
  const accent = (spec.pptx?.theme?.accent ?? "#2457FF").replace(/^#/, "");
  const text = (spec.pptx?.theme?.text ?? "#EAF2FF").replace(/^#/, "");
  for (const s of (spec.pptx?.slides ?? []).slice(0, MAX_SLIDES)) {
    const slide = pptx.addSlide();
    slide.background = { color: bg };
    slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: accent } });
    if (s.title) {
      slide.addText(asStr(s.title, 200), {
        x: 0.6, y: 0.4, w: 12.1, h: 0.9,
        fontSize: 32, bold: true, color: text,
      });
    }
    const bullets = (s.bullets ?? []).map((b) => ({ text: asStr(b, 500), options: { breakLine: true, fontSize: 18, color: text } }));
    if (bullets.length > 0) {
      slide.addText(bullets, { x: 0.6, y: 1.5, w: 12.1, h: 5.4, valign: "top" });
    }
    if (s.notes) slide.addNotes(asStr(s.notes, 2000));
  }
  const buf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(buf as Buffer);
}

function buildPdf(spec: FileSpec): Buffer {
  const doc = new jsPDF({ unit: "pt" });
  const title = asStr(spec.pdf?.title, 200);
  let y = 56;
  if (title) {
    doc.setFontSize(20);
    doc.text(doc.splitTextToSize(title, 500), 40, y);
    y += 36;
  }
  doc.setFontSize(12);
  for (const line of spec.pdf?.lines ?? []) {
    const wrapped = doc.splitTextToSize(asStr(line, 2000) || " ", 515);
    for (const w of wrapped) {
      if (y > 760) {
        doc.addPage();
        y = 56;
      }
      doc.text(w, 40, y);
      y += 18;
    }
  }
  return Buffer.from(doc.output("arraybuffer"));
}

async function buildZip(spec: FileSpec): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of spec.files ?? []) {
    const name = sanitizeFilename(f.name ?? "file.txt", "file.txt").replace(/^\.+/, "");
    if (!name) continue;
    zip.file(name, f.content ?? "");
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

/** Generate the file. Throws on an invalid spec (validate first). */
export async function generateFile(spec: FileSpec): Promise<Buffer> {
  const err = validateSpec(spec);
  if (err) throw new Error(err);
  switch (spec.type) {
    case "docx":
      return buildDocx(spec);
    case "xlsx":
      return buildXlsx(spec);
    case "pptx":
      return buildPptx(spec);
    case "pdf":
      return buildPdf(spec);
    case "zip":
      return buildZip(spec);
    default:
      return Buffer.from(spec.content ?? "", "utf-8");
  }
}
