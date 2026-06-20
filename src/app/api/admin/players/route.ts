import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/session";
import { getPlayer, deletePlayer, deleteGoldenBoot } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin delete from the /admin page. Two flavours, picked by `kind`:
//   - "pool"       → delete the whole player account (bracket, AI session and
//                    Golden Boot entry all cascade). For clearing duplicates.
//   - "goldenBoot" → drop only the player's Golden Boot submission; the account
//                    and bracket stay put.
// Session-gated to the one blessed account, same as the paid toggle.
export async function DELETE(req: NextRequest) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json()) as {
    playerId?: string;
    kind?: "pool" | "goldenBoot";
  };
  if (!body.playerId || !getPlayer(body.playerId)) {
    return NextResponse.json({ error: "Unknown player." }, { status: 400 });
  }
  const deleted =
    body.kind === "goldenBoot"
      ? deleteGoldenBoot(body.playerId)
      : deletePlayer(body.playerId);
  return NextResponse.json({ ok: true, deleted });
}
