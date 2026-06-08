import { NextRequest, NextResponse } from "next/server";
import { getDraft, saveDraft, markAiAssisted } from "@/lib/repo";
import { getSessionPlayerId } from "@/lib/session";
import { isLocked, kvGet, KV } from "@/lib/db";
import type { DraftBracket } from "@/lib/bracketState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const id = await getSessionPlayerId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { draft, submittedAt } = getDraft(id);
  return NextResponse.json({
    draft,
    submittedAt,
    locked: isLocked(),
    lockAt: kvGet<string | null>(KV.lockAt, null),
  });
}

export async function POST(req: NextRequest) {
  const id = await getSessionPlayerId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (isLocked()) {
    return NextResponse.json(
      { error: "Brackets are locked — the tournament has started." },
      { status: 423 },
    );
  }
  const { draft, submit, aiAssisted } = (await req.json()) as {
    draft: DraftBracket;
    submit?: boolean;
    aiAssisted?: boolean;
  };
  saveDraft(id, draft, !!submit);
  // Sticky AI-assisted flag, set when the player accepts an AI-built bracket.
  if (aiAssisted) markAiAssisted(id);
  return NextResponse.json({ ok: true });
}
