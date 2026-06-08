// ─────────────────────────────────────────────────────────────────────────────
// Bedrock Converse (streaming) client for AI Mode. Grounds the
// model in the verified 48-team field + exact scoring rules, exposes a single
// propose_bracket tool, and streams text deltas. A cache breakpoint on the
// static system block keeps real AWS cost (and latency) down on every turn after
// the first. Server-only.
// ─────────────────────────────────────────────────────────────────────────────

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message,
  type SystemContentBlock,
  type ToolConfiguration,
} from "@aws-sdk/client-bedrock-runtime";
import type { DocumentType } from "@smithy/types";
import { GROUP_IDS, teamsInGroup } from "./teams";
import {
  GROUP_ADVANCE_POINTS,
  GROUP_WINNER_BONUS,
  ROUND_POINTS,
  PAYOUT_SPLIT,
} from "./tournament";
import { MODELS, type ModelKey, type TokenUsage } from "./aiBudget";
import { PROPOSE_BRACKET_INPUT_SCHEMA } from "./aiProposal";

let _client: BedrockRuntimeClient | null = null;
function client(): BedrockRuntimeClient {
  if (!_client) {
    _client = new BedrockRuntimeClient({ region: process.env.AWS_REGION ?? "us-east-1" });
  }
  return _client;
}

// ── System prompt (static → cacheable) ──────────────────────────────────────

function teamRoster(): string {
  return GROUP_IDS.map(
    (g) => `Group ${g}: ${teamsInGroup(g).map((t) => `${t.name} (${t.id})`).join(", ")}`,
  ).join("\n");
}

const SYSTEM_PROMPT = `You are an AI advisor for a friends-and-family World Cup 2026 bracket pool ($50 buy-in, winner-takes-most). You help a player build their bracket through conversation.

HOW THE POOL SCORES (so your advice is strategy-aware):
- Players predict WHICH TEAMS REACH EACH ROUND, not individual matchups.
- Group stage: +${GROUP_ADVANCE_POINTS} for each team correctly picked to finish top 2 of its group, +${GROUP_WINNER_BONUS} bonus for naming the group winner.
- Reaching a knockout round (per correct team): Round of 16 = ${ROUND_POINTS.R16}, Quarterfinal = ${ROUND_POINTS.QF}, Semifinal = ${ROUND_POINTS.SF}, Final = ${ROUND_POINTS.FINAL}, Champion = ${ROUND_POINTS.CHAMPION}.
- Deep-running picks are worth far more than group-stage points, so the back of the bracket is where pools are won or lost.
- Payout: top 3 split the pot ${PAYOUT_SPLIT.map((f) => Math.round(f * 100) + "%").join(" / ")}. There is also a just-for-fun "spirit team" (any team; no money).

THE 48-TEAM FIELD (use the parenthesized id when you call the tool):
${teamRoster()}

BRACKET RULES — these are EXACT counts; getting them wrong drops picks:
- groups: rank exactly the top 3 of each of the 12 groups (1st, 2nd, 3rd). Top 2 auto-advance.
- bestThirds: exactly 8 ids, each one of the twelve teams you ranked 3rd in its group.
- The knockout rounds must NEST — each is a strict subset of the one before it, at EXACTLY these sizes:
  • r16 = exactly 16 teams, all drawn from your 24 group-qualifiers + 8 wildcards.
  • qf  = exactly 8 teams, all from your r16.
  • sf  = exactly 4 teams, all from your qf.
  • final = exactly 2 teams, both from your sf.
  • champion = exactly ONE id, and it MUST be one of your two final teams.
Double-check the counts and the nesting before you call the tool.

THE SPIRIT TEAM (don't choose it for them):
- The spirit team is a PERSONAL, sentimental pick — a heritage country, a hometown side, a dark horse they love — and no money rides on it. It's the one pick that should come from the player, not from strategy.
- Do NOT silently assign a spirit team. If the player hasn't told you who it is, ASK before you propose ("Who's your spirit team — anyone you're rooting for, win or lose?").
- If you must propose before they've answered (e.g. they just want a full bracket now), still fill spiritTeamId, but say plainly in your message that it's a placeholder and they should swap it for whoever they actually love. After accepting, they can change it in the editor.

YOUR JOB:
- Be concise and punchy — this is a phone screen. Lead with picks and reasoning, not preamble.
- Draw out the player's STRATEGY (chalk vs. contrarian, a hometown bias, how much risk) and reflect it in the bracket.
- IMPORTANT: your training data predates June 2026, so you do NOT reliably know current form, injuries, qualifiers, or this exact draw. When you're guessing about recent form, say so plainly. Never invent specific recent results.
- When the player is ready, or asks for a bracket, ALWAYS write one or two sentences naming your key calls (champion, biggest upset) FIRST, then call propose_bracket in the SAME turn with a COMPLETE, valid bracket. Never call the tool silently. You may propose again as the plan evolves; it just updates their on-screen preview. Remind them they can accept it (it pre-fills, still editable) or keep refining — and to set their spirit team if they haven't.`;

const SYSTEM: SystemContentBlock[] = [
  { text: SYSTEM_PROMPT },
  // Cache breakpoint: the big static block above is reused every turn.
  { cachePoint: { type: "default" } } as unknown as SystemContentBlock,
];

const TOOL_CONFIG: ToolConfiguration = {
  tools: [
    {
      toolSpec: {
        name: "propose_bracket",
        description:
          "Submit a complete proposed bracket to display in the player's preview. Call this whenever you have a full set of picks reflecting the conversation so far.",
        inputSchema: { json: PROPOSE_BRACKET_INPUT_SCHEMA as unknown as DocumentType },
      },
    },
  ],
};

// ── Streaming ────────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "tool"; toolUseId: string; name: string; input: unknown }
  | { type: "usage"; usage: TokenUsage }
  | { type: "stop"; stopReason: string };

export interface ConverseOpts {
  model: ModelKey;
  messages: Message[];
  /** Force one final propose_bracket call (used when the budget is spent). */
  forceFinal?: boolean;
}

/**
 * Run one Converse turn, yielding text deltas, any tool call (with its parsed
 * JSON input), the final token usage, and the stop reason. The caller assembles
 * the assistant message to persist and bills the usage.
 */
export async function* runConverse(opts: ConverseOpts): AsyncGenerator<StreamEvent> {
  const toolConfig: ToolConfiguration = opts.forceFinal
    ? { ...TOOL_CONFIG, toolChoice: { tool: { name: "propose_bracket" } } }
    : TOOL_CONFIG;

  const cmd = new ConverseStreamCommand({
    modelId: MODELS[opts.model].id,
    system: SYSTEM,
    messages: opts.messages,
    toolConfig,
    // Lower temperature on the forced final maximizes a clean, fully-nested
    // one-shot bracket; interactive turns get more warmth for discussion.
    inferenceConfig: { maxTokens: 1800, temperature: opts.forceFinal ? 0.2 : 0.7 },
  });

  const res = await client().send(cmd);
  if (!res.stream) return;

  // Tool-use input arrives as a stream of partial JSON strings per content block.
  const toolByIndex = new Map<number, { toolUseId: string; name: string; json: string }>();

  for await (const ev of res.stream) {
    if (ev.contentBlockStart?.start?.toolUse) {
      const { toolUseId, name } = ev.contentBlockStart.start.toolUse;
      toolByIndex.set(ev.contentBlockStart.contentBlockIndex ?? 0, {
        toolUseId: toolUseId ?? "",
        name: name ?? "",
        json: "",
      });
    }
    if (ev.contentBlockDelta?.delta) {
      const d = ev.contentBlockDelta.delta;
      if (d.text) yield { type: "text", text: d.text };
      if (d.toolUse?.input !== undefined) {
        const idx = ev.contentBlockDelta.contentBlockIndex ?? 0;
        const t = toolByIndex.get(idx);
        if (t) t.json += d.toolUse.input;
      }
    }
    if (ev.contentBlockStop) {
      const idx = ev.contentBlockStop.contentBlockIndex ?? 0;
      const t = toolByIndex.get(idx);
      if (t) {
        let input: unknown = {};
        try {
          input = t.json ? JSON.parse(t.json) : {};
        } catch {
          input = {};
        }
        yield { type: "tool", toolUseId: t.toolUseId, name: t.name, input };
      }
    }
    if (ev.metadata?.usage) {
      yield {
        type: "usage",
        usage: {
          inputTokens: ev.metadata.usage.inputTokens ?? 0,
          outputTokens: ev.metadata.usage.outputTokens ?? 0,
        },
      };
    }
    if (ev.messageStop) {
      yield { type: "stop", stopReason: ev.messageStop.stopReason ?? "end_turn" };
    }
  }
}
