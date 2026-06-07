import { NextRequest, NextResponse } from "next/server";
import { checkPasscode, getPlayer, upsertPlayerByName } from "@/lib/repo";
import { clearSession, getSessionPlayerId, setSessionPlayerId } from "@/lib/session";

export const runtime = "nodejs"; // node:sqlite needs the Node runtime, not edge
export const dynamic = "force-dynamic";

export async function GET() {
  const id = await getSessionPlayerId();
  return NextResponse.json({ player: id ? getPlayer(id) : null });
}

export async function POST(req: NextRequest) {
  const { name, passcode } = (await req.json()) as {
    name?: string;
    passcode?: string;
  };
  if (!name?.trim()) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (!checkPasscode(passcode ?? "")) {
    return NextResponse.json({ error: "Wrong group passcode." }, { status: 401 });
  }
  const player = upsertPlayerByName(name);
  await setSessionPlayerId(player.id);
  return NextResponse.json({ player });
}

export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
