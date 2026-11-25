import { NextResponse } from "next/server";
import { getImageStats } from "@/lib/freeImage";

/** force-dynamic: this route reports LIVE in-memory counters — it
 * must execute on every request, never serve a prerendered/cached
 * response (a cached copy would freeze the counters at build time). */
export const dynamic = "force-dynamic";

/**
 * GET /api/status — app health flags for the admin dashboard.
 * Returns ONLY booleans about whether env vars are present, plus
 * the free image provider's in-memory counters (attempts/successes/
 * busy/failures — counts only, no prompts, no user data).
 * The Gemini key VALUE is never returned, logged, or exposed here.
 */
export async function GET() {
  return NextResponse.json({
    supabaseConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ),
    geminiConfigured: Boolean(
      process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY
    ),
    geminiModel: "gemini-3-flash-preview",
    images: getImageStats(),
  });
}
