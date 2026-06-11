import { NextRequest, NextResponse } from "next/server";
import { getMatchFeed, setMatchFeed, type MatchFeed } from "@/lib/matches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The score poller (GitHub Actions cron) POSTs the match-level feed here —
// played group matches + upcoming fixtures (see lib/matches.ts). Same shared-
// secret auth as /api/admin/results.
function authed(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(getMatchFeed());
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as MatchFeed;
  if (!Array.isArray(body?.played) || !Array.isArray(body?.upcoming)) {
    return NextResponse.json({ error: "Bad feed shape" }, { status: 400 });
  }
  setMatchFeed({ ...body, fetchedAt: body.fetchedAt ?? new Date().toISOString() });
  return NextResponse.json({ ok: true, played: body.played.length, upcoming: body.upcoming.length });
}
