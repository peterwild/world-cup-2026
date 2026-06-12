import { NextResponse } from "next/server";
import { getLiveView } from "@/lib/liveScores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public read for the leaderboard's live strip. The heavy lifting (and the
// football-data call budget) lives in lib/liveScores.ts — this just serves the
// adaptively-cached view. No auth: it's read-only public scores, and the box's
// own cache is what actually rate-limits upstream calls.
export async function GET() {
  const view = await getLiveView();
  return NextResponse.json(view, {
    // Client polls on its own cadence; don't let a CDN/proxy pin a stale copy.
    headers: { "Cache-Control": "no-store" },
  });
}
