import { NextRequest } from "next/server";
import type { Message, ContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { getSessionPlayerId } from "@/lib/session";
import { getAiSession, getBuyInCents, recordAiTurn } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { costCents, isModelKey, isOverBudget, remainingCents, type TokenUsage } from "@/lib/aiBudget";
import { proposalToDraft } from "@/lib/aiProposal";
import { runConverse } from "@/lib/bedrock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** If the last turn ended in a tool call, the next user message must open with a
 *  toolResult for that toolUseId (Converse requires the result before more
 *  input). Our tool is display-only, so the result is a simple acknowledgement. */
function pendingToolResult(messages: Message[]): ContentBlock | null {
  const last = messages[messages.length - 1];
  if (last?.role !== "assistant") return null;
  const tu = (last.content ?? []).find((b) => b.toolUse)?.toolUse;
  if (!tu?.toolUseId) return null;
  return {
    toolResult: {
      toolUseId: tu.toolUseId,
      content: [{ text: "Bracket displayed to the player for review." }],
      status: "success",
    },
  };
}

export async function POST(req: NextRequest) {
  const id = await getSessionPlayerId();
  if (!id) return json({ error: "Not signed in" }, 401);
  if (isLocked()) {
    return json({ error: "Brackets are locked — the tournament has started." }, 423);
  }

  const session = getAiSession(id);
  if (!isModelKey(session.model)) {
    return json({ error: "Pick a model first." }, 400);
  }
  const model = session.model;

  const budgetCents = getBuyInCents();
  const spent = session.spendCents;
  const over = isOverBudget(budgetCents, spent);

  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  const messages = session.transcript as Message[];

  // Out of budget: if we already have a final bracket, hand it back with no new
  // model call. Otherwise fall through and force one last propose_bracket.
  if (over && session.proposal) {
    return json({
      overBudget: true,
      proposal: session.proposal,
      spentCents: spent,
      remainingCents: 0,
      budgetCents,
      message: "You're out of budget — here's your final bracket.",
    });
  }

  const forceFinal = over; // over budget + no proposal yet → forced final turn
  if (!forceFinal && !message?.trim()) {
    return json({ error: "Empty message." }, 400);
  }

  // Build this turn's user message (toolResult, if pending, must come first).
  const userContent: ContentBlock[] = [];
  const pending = pendingToolResult(messages);
  if (pending) userContent.push(pending);
  userContent.push({
    text: forceFinal
      ? "I'm out of AI budget. Call propose_bracket now with your single best complete bracket — no other commentary."
      : message!.trim(),
  });
  messages.push({ role: "user", content: userContent });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      let assistantText = "";
      const toolBlocks: ContentBlock[] = [];
      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
      let newProposalDraft: unknown | undefined;

      try {
        for await (const ev of runConverse({ model, messages, forceFinal })) {
          if (ev.type === "text") {
            assistantText += ev.text;
            send({ type: "text", text: ev.text });
          } else if (ev.type === "tool") {
            // Persist the raw model input in the transcript (keeps Converse
            // history valid); send the cleaned DraftBracket to the preview.
            toolBlocks.push({
              toolUse: { toolUseId: ev.toolUseId, name: ev.name, input: ev.input as DocumentType },
            });
            newProposalDraft = proposalToDraft(ev.input);
            send({ type: "proposal", proposal: newProposalDraft });
          } else if (ev.type === "usage") {
            usage = ev.usage;
          }
        }
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "AI error" });
      }

      // Assemble + persist the assistant turn, then bill the tokens.
      const assistantContent: ContentBlock[] = [];
      if (assistantText.trim()) assistantContent.push({ text: assistantText });
      assistantContent.push(...toolBlocks);
      if (assistantContent.length) messages.push({ role: "assistant", content: assistantContent });

      const turnCost = costCents(model, usage);
      recordAiTurn(id, turnCost, messages, newProposalDraft);

      const newSpent = spent + turnCost;
      send({
        type: "done",
        costCents: turnCost,
        spentCents: newSpent,
        remainingCents: remainingCents(budgetCents, newSpent),
        budgetCents,
        overBudget: isOverBudget(budgetCents, newSpent),
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
