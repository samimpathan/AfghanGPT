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
import { fontFace, parsePercentBars, type SlideLayout } from "./slideStyles";

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
  /** pptx: { title, slides: [{ title, bullets[], notes?, layout?, image? }], theme?, rtl? } — rtl marks an Arabic-script (Pashto/Dari/Arabic) deck: paragraphs get right alignment + the RTL flag, and the presentation gets rtlMode. When rtl is omitted it is auto-detected from the slide text. layout is one of cover/contents/textImage/imageLed/twoColumn/highlight/chart and changes the slide geometry (cover = big title + optional image, contents = numbered rows, textImage = text left + picture right, imageLed = picture left + text right, twoColumn = bullets split in two, highlight = first bullet large, chart = bars from the slide's own percentages). image: { url, credit? } is downloaded server-side and embedded as a SEPARATE picture shape — all text stays real editable text shapes, never a picture of text. theme: { bg, accent, text, sub, card, titleFont, bodyFont, titleUppercase, titleCharSpacing, accentBar }. */
  pptx?: {
    title?: string;
    slides?: { title?: string; bullets?: string[]; notes?: string; layout?: SlideLayout; image?: { url?: string; credit?: string } }[];
    theme?: { bg?: string; accent?: string; text?: string; sub?: string; card?: string; titleFont?: string; bodyFont?: string; titleUppercase?: boolean; titleCharSpacing?: number; accentBar?: "top" | "side" | "bottom" | "none" };
    rtl?: boolean;
  };
  /** pdf: { title, lines[] } — rtl (when true, or auto-detected from the lines) right-aligns the text. */
  pdf?: { title?: string; lines?: string[]; rtl?: boolean };
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

/** Arabic-script detection (same ranges as the Slides Studio): a
 * Pashto/Dari/Arabic deck must render RTL. Used as the fallback when
 * a spec does not carry an explicit rtl flag. */
const RTL_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
function isRtlText(s: string): boolean {
  return RTL_RE.test(s);
}

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
  const raw = sanitizeFilename(spec.filename, `afghangpt-file.${ext}`);
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
  wb.creator = "AfghanGPT";
  for (const sheet of spec.xlsx?.sheets ?? []) {
    const ws = wb.addWorksheet(sanitizeFilename(sheet.name ?? "Sheet1", "Sheet1").slice(0, 31));
    for (const row of asRows(sheet.rows)) ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/** Download an image URL to a data URI for embedding. Fail-soft:
 * any error / non-image / too-large result returns null and the
 * slide is exported text-only — an export NEVER fails over a picture. */
async function downloadImageToDataUri(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    // SVG cannot be embedded as a picture shape — skip it.
    if (!ct.startsWith("image/") || ct.includes("svg")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 3_000_000) return null;
    return `data:${ct};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function buildPptx(spec: FileSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = "AfghanGPT";
  pptx.title = asStr(spec.pptx?.title, 200) || "AfghanGPT Presentation";
  pptx.defineLayout({ name: "WIDE", width: 13.33, height: 7.5 });
  pptx.layout = "WIDE";
  // RTL decks (Pashto/Dari/Arabic): an explicit flag wins; otherwise
  // auto-detect from the slide text. Without this, pptxgenjs emits
  // plain LTR paragraphs (no rtl flag, no alignment) and phone
  // viewers render Pashto lines left-aligned with bullet markers and
  // numbers at the WRONG end and English terms displaced — the
  // founder's 2026-11-25 screenshots. rtlMode (presentation) + align
  // right + rtlMode (per text) make every viewer render the deck RTL.
  const slides = (spec.pptx?.slides ?? []).slice(0, MAX_SLIDES);
  const rtl =
    spec.pptx?.rtl === true ||
    (spec.pptx?.rtl === undefined &&
      slides.some((s) => isRtlText(s.title ?? "") || (s.bullets ?? []).some((b) => isRtlText(b))));
  if (rtl) pptx.rtlMode = true;
  // Style (from the Presentation Maker): defaults match AfghanGPT's
  // dark palette, so files made without a style look exactly as before.
  const theme = spec.pptx?.theme ?? {};
  const bg = (theme.bg ?? "#0D1426").replace(/^#/, "");
  const accent = (theme.accent ?? "#2457FF").replace(/^#/, "");
  const text = (theme.text ?? "#EAF2FF").replace(/^#/, "");
  const sub = (theme.sub ?? "#AAB7D0").replace(/^#/, "");
  const card = (theme.card ?? "#111B30").replace(/^#/, "");
  const titleFont = fontFace(theme.titleFont ?? "Arial");
  const bodyFont = fontFace(theme.bodyFont ?? "Arial");
  const titleUpper = theme.titleUppercase === true;
  const titleSpacing = typeof theme.titleCharSpacing === "number" ? theme.titleCharSpacing : 0;
  const accentBar = theme.accentBar ?? "top";
  const align: "left" | "right" = rtl ? "right" : "left";
  // Download every slide image up front (parallel, fail-soft) so a
  // slow or dead image host cannot stall the export slide by slide.
  const imgDatas = await Promise.all(
    slides.map((s) => (s.image?.url ? downloadImageToDataUri(s.image.url) : Promise.resolve(null)))
  );
  const titleText = (t: string): string => {
    const clean = asStr(t, 200);
    return titleUpper ? clean.toUpperCase() : clean;
  };
  for (let si = 0; si < slides.length; si++) {
    const s = slides[si];
    const slide = pptx.addSlide();
    slide.background = { color: bg };
    // Full-slide background rect (same colour, drawn first so it sits
    // behind everything): some phone viewers ignore the slide's own
    // background fill, which left white text on a white slide — the
    // founder's Conclusion slide rendered washed-out and unreadable.
    // An explicit shape always renders, so the contrast is guaranteed.
    slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 7.5, fill: { color: bg }, line: { color: bg } });
    // Style accent bar (top / side / bottom / none).
    if (accentBar === "top") slide.addShape("rect", { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: accent } });
    else if (accentBar === "side") slide.addShape("rect", { x: 0, y: 0, w: 0.12, h: 7.5, fill: { color: accent } });
    else if (accentBar === "bottom") slide.addShape("rect", { x: 0, y: 7.38, w: 13.33, h: 0.12, fill: { color: accent } });
    const img = imgDatas[si];
    const layout = s.layout ?? "textImage";
    const bullets = (s.bullets ?? []).filter(Boolean);
    // Bullets as runs — NOTE: rtlMode MUST be on each bullet RUN's
    // options, not just the shape options — pptxgenjs only reads
    // e[0].options.rtlMode per paragraph group for array input, so a
    // shape-level rtlMode lands on the first paragraph only
    // (verified in the exported XML).
    const bulletRuns = bullets.map((b) => ({
      text: asStr(b, 500),
      options: { breakLine: true, fontSize: 18, color: text, fontFace: bodyFont, rtlMode: rtl },
    }));
    const addBullets = (x: number, y: number, w: number, h: number, fontSize = 18): void => {
      if (bulletRuns.length === 0) return;
      slide.addText(
        bulletRuns.map((r) => ({ ...r, options: { ...r.options, fontSize } })),
        { x, y, w, h, valign: "top", align, rtlMode: rtl, fit: "shrink" }
      );
    };
    const addTitle = (x: number, y: number, w: number, h: number, fontSize: number, a: "left" | "right" | "center" = align): void => {
      if (!s.title) return;
      slide.addText(titleText(s.title), {
        x, y, w, h, fontSize, bold: true, color: text, fontFace: titleFont,
        align: a, rtlMode: rtl, fit: "shrink", ...(titleSpacing ? { charSpacing: titleSpacing } : {}),
      });
    };
    const addCredit = (x: number, y: number, w: number): void => {
      const credit = s.image?.credit;
      if (!img || !credit) return;
      slide.addText(asStr(credit, 120), { x, y, w, h: 0.3, fontSize: 8, color: sub, align: "left" });
    };
    const addImage = (x: number, y: number, w: number, h: number): void => {
      if (!img) return;
      slide.addImage({ data: img, x, y, w, h, sizing: { type: "cover", w, h } });
    };
    if (layout === "cover") {
      if (img) {
        addImage(7.2, 0, 6.13, 7.5);
        addTitle(0.7, 2.0, 6.0, 1.8, 40);
        if (bullets[0]) {
          slide.addText(asStr(bullets[0], 300), { x: 0.7, y: 4.0, w: 6.0, h: 1.4, fontSize: 18, color: sub, fontFace: bodyFont, align, rtlMode: rtl, fit: "shrink" });
        }
      } else {
        addTitle(0.6, 2.5, 12.1, 1.4, 40, "center");
        if (bullets[0]) {
          slide.addText(asStr(bullets[0], 300), { x: 0.6, y: 4.1, w: 12.1, h: 1.0, fontSize: 18, color: sub, fontFace: bodyFont, align: "center", rtlMode: rtl, fit: "shrink" });
        }
      }
    } else if (layout === "contents") {
      addTitle(0.6, 0.4, 12.1, 0.9, 32);
      if (bullets.length > 0) {
        const rows = bullets.flatMap((b, i) => [
          { text: `${i + 1}. `, options: { color: accent, bold: true, fontSize: 20, fontFace: bodyFont, rtlMode: rtl } },
          { text: asStr(b, 500), options: { breakLine: true, fontSize: 20, color: text, fontFace: bodyFont, rtlMode: rtl } },
        ]);
        slide.addText(rows, { x: 0.6, y: 1.6, w: 12.1, h: 5.2, valign: "top", align, rtlMode: rtl, fit: "shrink" });
      }
    } else if (layout === "imageLed") {
      if (img) {
        addImage(0, 0, 5.2, 7.5);
        addTitle(5.8, 0.5, 6.9, 0.9, 28);
        addBullets(5.8, 1.6, 6.9, 5.2);
      } else {
        addTitle(0.6, 0.4, 12.1, 0.9, 32);
        addBullets(0.6, 1.5, 12.1, 5.4);
      }
    } else if (layout === "twoColumn") {
      addTitle(0.6, 0.4, 12.1, 0.9, 32);
      let colY = 1.5;
      let colH = 5.4;
      if (img) {
        addImage(0.6, 1.35, 12.1, 1.6);
        addCredit(0.6, 2.98, 12.1);
        colY = 3.35;
        colH = 3.8;
      }
      const half = Math.ceil(bullets.length / 2);
      const left = bullets.slice(0, half).map((b) => ({
        text: asStr(b, 500),
        options: { breakLine: true, fontSize: 18, color: text, fontFace: bodyFont, rtlMode: rtl },
      }));
      const right = bullets.slice(half).map((b) => ({
        text: asStr(b, 500),
        options: { breakLine: true, fontSize: 18, color: text, fontFace: bodyFont, rtlMode: rtl },
      }));
      if (left.length > 0) slide.addText(left, { x: 0.6, y: colY, w: 5.9, h: colH, valign: "top", align, rtlMode: rtl, fit: "shrink" });
      if (right.length > 0) slide.addText(right, { x: 6.85, y: colY, w: 5.9, h: colH, valign: "top", align, rtlMode: rtl, fit: "shrink" });
    } else if (layout === "highlight") {
      if (img) {
        addImage(9.9, 0.4, 2.85, 5.2);
        addCredit(9.9, 5.7, 2.85);
        addTitle(0.6, 0.4, 8.9, 0.9, 32);
        if (bullets[0]) {
          slide.addText(asStr(bullets[0], 500), { x: 0.6, y: 1.7, w: 8.9, h: 1.8, fontSize: 26, bold: true, color: accent, fontFace: bodyFont, align, rtlMode: rtl, fit: "shrink" });
        }
        const rest = bullets.slice(1).map((b) => ({
          text: asStr(b, 500),
          options: { breakLine: true, fontSize: 18, color: text, fontFace: bodyFont, rtlMode: rtl },
        }));
        if (rest.length > 0) slide.addText(rest, { x: 0.6, y: 3.7, w: 8.9, h: 3.2, valign: "top", align, rtlMode: rtl, fit: "shrink" });
      } else {
        addTitle(0.6, 0.4, 12.1, 0.9, 32);
        if (bullets[0]) {
          slide.addText(asStr(bullets[0], 500), { x: 0.6, y: 1.7, w: 12.1, h: 1.8, fontSize: 26, bold: true, color: accent, fontFace: bodyFont, align, rtlMode: rtl, fit: "shrink" });
        }
        const rest = bullets.slice(1).map((b) => ({
          text: asStr(b, 500),
          options: { breakLine: true, fontSize: 18, color: text, fontFace: bodyFont, rtlMode: rtl },
        }));
        if (rest.length > 0) slide.addText(rest, { x: 0.6, y: 3.7, w: 12.1, h: 3.2, valign: "top", align, rtlMode: rtl, fit: "shrink" });
      }
    } else if (layout === "chart") {
      // Bars from the slide's OWN percentages only — parsePercentBars
      // returns null unless 2+ bullets carry a 0-100% figure, so a
      // chart is never drawn from invented numbers.
      const bars = parsePercentBars(bullets);
      if (bars) {
        addTitle(0.6, 0.4, 12.1, 0.9, 32);
        const max = Math.max(...bars.map((b) => b.value), 1);
        bars.forEach((bar, i) => {
          const rowY = 1.7 + i * 0.85;
          slide.addText(asStr(bar.label, 40), { x: 0.7, y: rowY, w: 3.4, h: 0.5, fontSize: 14, color: text, fontFace: bodyFont, align, rtlMode: rtl, fit: "shrink" });
          const trackX = 4.3;
          const trackW = 7.0;
          slide.addShape("rect", { x: trackX, y: rowY + 0.08, w: trackW, h: 0.34, fill: { color: card }, line: { color: card } });
          const fillW = Math.max(0.15, (trackW * bar.value) / max);
          const fillX = rtl ? trackX + trackW - fillW : trackX;
          slide.addShape("rect", { x: fillX, y: rowY + 0.08, w: fillW, h: 0.34, fill: { color: accent }, line: { color: accent } });
          slide.addText(`${bar.value}%`, { x: 11.5, y: rowY, w: 1.1, h: 0.5, fontSize: 14, bold: true, color: accent, fontFace: bodyFont, align: "left" });
        });
      } else {
        // No parseable numbers — fall back to the plain text layout
        // rather than faking a chart.
        addTitle(0.6, 0.4, 12.1, 0.9, 32);
        addBullets(0.6, 1.5, 12.1, 5.4);
      }
    } else {
      // textImage (default): text left, picture right; text-only
      // slides keep the classic full-width layout.
      if (img) {
        addTitle(0.6, 0.4, 7.2, 0.8, 28);
        addBullets(0.6, 1.5, 7.2, 5.2);
        addImage(8.2, 1.5, 4.5, 4.6);
        addCredit(8.2, 6.2, 4.5);
      } else {
        addTitle(0.6, 0.4, 12.1, 0.9, 32);
        addBullets(0.6, 1.5, 12.1, 5.4);
      }
    }
    if (s.notes) slide.addNotes(asStr(s.notes, 2000));
  }
  const buf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(buf as Buffer);
}

function buildPdf(spec: FileSpec): Buffer {
  const doc = new jsPDF({ unit: "pt" });
  // RTL decks right-align every line at the right margin (x = 555).
  // NOTE (honest limit): jsPDF's built-in fonts cannot shape Arabic
  // script, so Pashto glyphs still do not render in PDFs — only the
  // alignment is fixed here. A fully readable Pashto PDF needs an
  // embedded Arabic font + a shaping step, which is separate work.
  const lines = spec.pdf?.lines ?? [];
  const rtl =
    spec.pdf?.rtl === true ||
    (spec.pdf?.rtl === undefined &&
      (isRtlText(spec.pdf?.title ?? "") || lines.some((l) => isRtlText(l))));
  const x = rtl ? 555 : 40;
  const align = rtl ? "right" : "left";
  const title = asStr(spec.pdf?.title, 200);
  let y = 56;
  if (title) {
    doc.setFontSize(20);
    doc.text(doc.splitTextToSize(title, 500), x, y, { align });
    y += 36;
  }
  doc.setFontSize(12);
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(asStr(line, 2000) || " ", 515);
    for (const w of wrapped) {
      if (y > 760) {
        doc.addPage();
        y = 56;
      }
      doc.text(w, x, y, { align });
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
