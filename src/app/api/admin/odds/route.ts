import { NextRequest, NextResponse } from "next/server";
import { recomputeOdds } from "@/lib/odds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The poll-scores workflow POSTs here after pushing results, telling the box
// to re-run the Monte Carlo and refresh the cached odds. Same auth as
// /api/admin/results. `?force=1` bypasses the unchanged-inputs skip.
function authed(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-key") === key;
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const force = req.nextUrl.searchParams.get("force") === "1";
  const start = Date.now();
  const { snapshot, recomputed } = recomputeOdds(force);
  return NextResponse.json({
    ok: true,
    recomputed,
    ms: Date.now() - start,
    computedAt: snapshot.computedAt,
    entries: snapshot.entries.length,
  });
}
