import { NextRequest, NextResponse } from "next/server";
import { getSessionPlayerId } from "@/lib/session";
import { getAiSession, setAiModel } from "@/lib/repo";
import { isModelKey } from "@/lib/aiBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Choose the session model. Locked once a conversation has started — picking the
// model is a one-time strategic decision ("choose your model wisely").
export async function POST(req: NextRequest) {
  const id = await getSessionPlayerId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { model } = (await req.json()) as { model?: string };
  if (!isModelKey(model)) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 });
  }

  const session = getAiSession(id);
  if (session.transcript.length > 0) {
    return NextResponse.json(
      { error: "Model is locked once you've started a conversation." },
      { status: 409 },
    );
  }

  setAiModel(id, model);
  return NextResponse.json({ ok: true, model });
}
