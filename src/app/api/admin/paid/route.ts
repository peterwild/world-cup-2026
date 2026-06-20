import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/session";
import { getPlayer, setPlayerPaid } from "@/lib/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Flip a player's main-pool buy-in flag. UI-driven by the admin while logged in
// (session is_admin), NOT the shared x-admin-key used by the cron routes — this
// is a human action from the /admin page, gated to the one blessed account.
export async function POST(req: NextRequest) {
  if (!(await isAdminSession())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json()) as { playerId?: string; paid?: boolean };
  if (!body.playerId || !getPlayer(body.playerId)) {
    return NextResponse.json({ error: "Unknown player." }, { status: 400 });
  }
  const paid = !!body.paid;
  setPlayerPaid(body.playerId, paid);
  return NextResponse.json({ ok: true, paid });
}
