import { NextRequest } from "next/server";
import {
  generateFile,
  validateSpec,
  contentTypeFor,
  filenameFor,
  type FileSpec,
} from "@/lib/filegen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/files — generate a REAL file server-side and return it
 * as a binary download. No API key needed for generation itself.
 * Body: a FileSpec { type, filename, ... } (see lib/filegen.ts).
 * Specs are validated and capped; filenames are sanitised. */
export async function POST(req: NextRequest) {
  let spec: FileSpec;
  try {
    spec = (await req.json()) as FileSpec;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const err = validateSpec(spec);
  if (err) {
    return new Response(JSON.stringify({ error: err }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  try {
    const buffer = await generateFile(spec);
    const filename = filenameFor(spec);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentTypeFor(spec.type),
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("File generation failed:", e instanceof Error ? e.message : "unknown");
    return new Response(JSON.stringify({ error: "generation-failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
