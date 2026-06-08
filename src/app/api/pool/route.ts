import { NextResponse } from "next/server";
import { getAllEntries, getBuyInCents, getGroupName } from "@/lib/repo";
import { bracketComplete } from "@/lib/bracketState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public pool stats for the entry-screen teaser. No names, no PII — just the
// aggregate numbers (pot, entrant count, group name). The site sits behind
// nginx Basic Auth in prod, so this is already group-gated. "In the pool" means
// a *complete* bracket, matching how the leaderboard computes the pot.
export async function GET() {
  const buyInCents = getBuyInCents();
  const entrants = getAllEntries().filter((e) => bracketComplete(e.draft)).length;

  return NextResponse.json({
    groupName: getGroupName(),
    entrants,
    buyInCents,
    potCents: entrants * buyInCents,
  });
}
