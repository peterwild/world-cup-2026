import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/session";
import {
  getGoldenBoot,
  setGoldenBootStatus,
  setGoldenBootPick,
  getAllGoldenBoot,
  getGoldenBootStatusAt,
} from "@/lib/repo";
import {
  getCandidates,
  getGoldenBootBuyInCents,
  getGoldenBootResult,
  getScorers,
  goalsForPick,
  goldenBootLockAt,
  goldenBootLocked,
  goldenBootPot,
} from "@/lib/goldenBoot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const id = await getSessionPlayerId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const me = getGoldenBoot(id);
  const buyInCents = getGoldenBootBuyInCents();
  const all = getAllGoldenBoot();
  const scorers = getScorers();
  return NextResponse.json({
    status: me?.status ?? null, // null = hasn't answered the prompt yet
    // When they last set that status — lets the UI retire the "actually, I'm in"
    // nudge 48h after a decline instead of showing it for the whole tournament.
    statusAt: me ? getGoldenBootStatusAt(id) : null,
    pickId: me?.pickId ?? null,
    paid: me?.paid ?? false,
    candidates: getCandidates(),
    buyInCents,
    lockAt: goldenBootLockAt(),
    locked: goldenBootLocked(),
    result: getGoldenBootResult(),
    pot: goldenBootPot(all, buyInCents),
    participants: all.filter((e) => e.status === "in" && e.pickId).length,
    // Live race: your pick's tally (null = hasn't scored) + the top of the board.
    pickGoals: goalsForPick(scorers, me?.pickId ?? null),
    topScorers: scorers.slice(0, 5),
  });
}

export async function POST(req: NextRequest) {
  const id = await getSessionPlayerId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (goldenBootLocked()) {
    return NextResponse.json(
      { error: "Golden Boot picks are locked — the group stage is over." },
      { status: 423 },
    );
  }

  const { action, pickId } = (await req.json()) as {
    action: "opt_in" | "decline" | "pick";
    pickId?: string;
  };

  if (action === "decline") {
    setGoldenBootStatus(id, "declined");
    return NextResponse.json({ ok: true });
  }

  if (action === "opt_in") {
    setGoldenBootStatus(id, "in");
    return NextResponse.json({ ok: true });
  }

  if (action === "pick") {
    if (!pickId || !getCandidates().some((c) => c.id === pickId)) {
      return NextResponse.json({ error: "Unknown player pick." }, { status: 400 });
    }
    // Picking implies you're in — opt in if they weren't already (no-op if they were).
    setGoldenBootStatus(id, "in");
    setGoldenBootPick(id, pickId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
