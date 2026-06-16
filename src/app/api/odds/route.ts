import { NextResponse } from "next/server";
import { isLocked } from "@/lib/db";
import { getOdds } from "@/lib/odds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cached Monte Carlo pool odds, recomputed by the score cron (lib/odds.ts).
// Read-only — this never runs the sim. Post-lock only: pre-lock the odds would
// leak hints about brackets nobody is allowed to see yet. Like /api/pool, the
// site sits behind nginx Basic Auth in prod, so this is already group-gated.
export async function GET() {
  if (!isLocked()) return NextResponse.json({ available: false });
  const snapshot = getOdds();
  if (!snapshot) return NextResponse.json({ available: false });
  // Strip server-only bookkeeping: inputHash (skip key) and actual (the diff
  // baseline for the next recompute — live results ship via /api/live).
  const pub = { ...snapshot, inputHash: undefined, actual: undefined };
  return NextResponse.json({ available: true, ...pub });
}
