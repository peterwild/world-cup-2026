import { NextRequest, NextResponse } from "next/server";
import { kvSet, KV } from "@/lib/db";
import { setGoldenBootPaid, getAllGoldenBoot, getResults } from "@/lib/repo";
import {
  getCandidates,
  getGoldenBootBuyInCents,
  getGoldenBootResult,
  goldenBootLeader,
  goldenBootLockAt,
  resolveGoldenBoot,
  setScorers,
} from "@/lib/goldenBoot";
import type { ScorerStanding } from "@/lib/footballData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin ops for the Golden Boot side bet. Same shared-secret auth as
// /api/admin/results. In dev (no key set) it's open on localhost.
function authed(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const buyInCents = getGoldenBootBuyInCents();
  const all = getAllGoldenBoot();
  const result = getGoldenBootResult();
  return NextResponse.json({
    buyInCents,
    lockAt: goldenBootLockAt(),
    result,
    entries: all,
    resolution: result ? resolveGoldenBoot(all, result, buyInCents) : null,
  });
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as {
    op: "result" | "paid" | "lock" | "roster" | "scorers";
    pickId?: string;
    playerId?: string;
    paid?: boolean;
    lockAt?: string;
    candidates?: { id: string; name: string; teamId: string }[];
    scorers?: ScorerStanding[];
  };

  if (body.op === "scorers") {
    // Live goal table from the poller. Store it, then auto-resolve the winner
    // ONLY once the tournament is over (champion decided) and there's a sole
    // top scorer — a tie at the top is left for manual settlement, like the
    // real award. (Auto-match works because roster + scorers share fd player
    // ids; on the shortlist fallback ids wouldn't match, so resolve by hand.)
    const list = body.scorers;
    if (!Array.isArray(list)) {
      return NextResponse.json({ error: "scorers must be an array." }, { status: 400 });
    }
    setScorers(list);
    let autoResolved: string | null = null;
    const tournamentOver = (getResults().roundTeams.CHAMPION?.length ?? 0) > 0;
    if (tournamentOver && !getGoldenBootResult()) {
      const { leaders, tied } = goldenBootLeader(list);
      if (leaders.length === 1 && !tied) {
        kvSet(KV.goldenBootResult, leaders[0].id);
        autoResolved = leaders[0].id;
      }
    }
    return NextResponse.json({ ok: true, count: list.length, autoResolved });
  }

  if (body.op === "roster") {
    // Cache the full tournament roster (from scripts/fetch-roster.mjs). Picker
    // reads it via getCandidates(); empty/absent → shortlist fallback.
    const list = body.candidates;
    if (!Array.isArray(list) || list.some((c) => !c?.id || !c?.name || !c?.teamId)) {
      return NextResponse.json({ error: "candidates must be {id,name,teamId}[]." }, { status: 400 });
    }
    kvSet(KV.goldenBootRoster, list);
    return NextResponse.json({ ok: true, count: list.length });
  }

  if (body.op === "result") {
    if (!body.pickId || !getCandidates().some((c) => c.id === body.pickId)) {
      return NextResponse.json({ error: "Unknown candidate id." }, { status: 400 });
    }
    kvSet(KV.goldenBootResult, body.pickId);
    const all = getAllGoldenBoot();
    return NextResponse.json({
      ok: true,
      resolution: resolveGoldenBoot(all, body.pickId, getGoldenBootBuyInCents()),
    });
  }

  if (body.op === "paid") {
    if (!body.playerId) {
      return NextResponse.json({ error: "playerId required." }, { status: 400 });
    }
    setGoldenBootPaid(body.playerId, !!body.paid);
    return NextResponse.json({ ok: true });
  }

  if (body.op === "lock") {
    // Pin the lock time explicitly (overrides the feed-derived first-R32 default).
    kvSet(KV.goldenBootLockAt, body.lockAt ?? null);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
