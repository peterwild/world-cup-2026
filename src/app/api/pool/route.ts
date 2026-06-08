import { NextResponse } from "next/server";
import { getGroupName } from "@/lib/repo";
import { computeLeaderboard } from "@/lib/standings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public pool stats for the entry-screen teaser. No names, no PII — just the
// aggregate numbers (pot, entrant count, group name). The site sits behind
// nginx Basic Auth in prod, so this is already group-gated.
//
// Reuses computeLeaderboard so "who's in the pool" is defined in exactly ONE
// place — otherwise the teaser and the leaderboard can disagree (they did once
// the leaderboard's membership became sticky).
export async function GET() {
  const board = computeLeaderboard();

  return NextResponse.json({
    groupName: getGroupName(),
    entrants: board.entrants,
    buyInCents: board.buyInCents,
    potCents: board.potCents,
  });
}
