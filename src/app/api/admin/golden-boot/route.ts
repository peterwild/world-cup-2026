import { NextRequest, NextResponse } from "next/server";
import { kvSet, KV } from "@/lib/db";
import { setGoldenBootPaid, getAllGoldenBoot } from "@/lib/repo";
import {
  getCandidates,
  getGoldenBootBuyInCents,
  getGoldenBootResult,
  goldenBootLockAt,
  resolveGoldenBoot,
} from "@/lib/goldenBoot";

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
    op: "result" | "paid" | "lock" | "roster";
    pickId?: string;
    playerId?: string;
    paid?: boolean;
    lockAt?: string;
    candidates?: { id: string; name: string; teamId: string }[];
  };

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
