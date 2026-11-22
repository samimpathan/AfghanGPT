import { NextResponse } from "next/server";

/**
 * GET /api/status — app health flags for the admin dashboard.
 * Returns ONLY booleans about whether env vars are present.
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
  });
}
