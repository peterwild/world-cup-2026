import { NextResponse } from "next/server";
import type { Message } from "@aws-sdk/client-bedrock-runtime";
import { getSessionPlayerId } from "@/lib/session";
import { getAiSession, getBuyInCents } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { remainingCents, isOverBudget } from "@/lib/aiBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Flatten stored Converse messages into chat bubbles the client can render.
 *  Drops tool plumbing (toolUse / toolResult blocks) — the bracket lives in the
 *  preview, not the transcript. */
function toBubbles(transcript: unknown[]): { role: string; text: string }[] {
  const out: { role: string; text: string }[] = [];
  for (const m of transcript as Message[]) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = (m.content ?? [])
      .map((b) => b.text ?? "")
      .join("")
      .trim();
    if (text) out.push({ role: m.role, text });
  }
  return out;
}

export async function GET() {
  const id = await getSessionPlayerId();
  if (!id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const session = getAiSession(id);
  const budgetCents = getBuyInCents();

  return NextResponse.json({
    model: session.model,
    spendCents: session.spendCents,
    budgetCents,
    remainingCents: remainingCents(budgetCents, session.spendCents),
    overBudget: isOverBudget(budgetCents, session.spendCents),
    messages: toBubbles(session.transcript),
    proposal: session.proposal,
    locked: isLocked(),
  });
}
