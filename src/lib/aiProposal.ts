// ─────────────────────────────────────────────────────────────────────────────
// The `propose_bracket` tool contract: the JSON schema the model fills, plus a
// TOLERANT mapping from a model proposal to our DraftBracket. The model is not
// trusted to be internally consistent (it may hallucinate ids or pick a team
// into a round it didn't advance) — we filter to valid ids, enforce group
// membership, clamp sizes, and run cascadeTrim so the result is always a clean,
// consistent draft the wizard can pre-fill. Pure (no SDK) so it's unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { GROUP_IDS, TEAMS, TEAMS_BY_ID, teamsInGroup } from "./teams";
import { ROUND_SIZE } from "./tournament";
import {
  emptyDraft,
  groupAdvancers,
  thirdPlaceTeams,
  type DraftBracket,
} from "./bracketState";

const idList = z.array(z.string()).default([]);

/** Raw model output. Everything optional/lenient — a partial proposal still
 *  parses; proposalToDraft fills in what's valid. */
export const ProposalSchema = z.object({
  groups: z.record(z.string(), z.array(z.string())).default({}),
  bestThirds: idList,
  r16: idList,
  qf: idList,
  sf: idList,
  final: idList,
  champion: z.string().nullish(),
  spirit: z.string().nullish(),
  finalGoals: z.number().nullish(),
});

export type Proposal = z.infer<typeof ProposalSchema>;

const isValidId = (id: string): boolean => id in TEAMS_BY_ID;

/**
 * Build one round's set: every `forced` team (from deeper rounds — reaching a
 * later round means you reached this one) comes first, then the model's own
 * picks fill the rest, up to `cap`. Dedupes; keeps order. This NESTS UPWARD, so
 * the result is always champion ⊆ final ⊆ sf ⊆ qf ⊆ r16 with the model's intent
 * preserved (a deep pick the model forgot to list in an earlier round is added
 * back, rather than the deep pick being thrown away).
 */
function buildRound(modelPicks: string[], forced: string[], cap: number): string[] {
  const out: string[] = [];
  for (const id of [...forced, ...modelPicks]) {
    if (out.length >= cap) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/** Map a (possibly messy) model proposal to a clean, consistent DraftBracket. */
export function proposalToDraft(input: unknown): DraftBracket {
  const p = ProposalSchema.parse(input ?? {});
  const d = emptyDraft();

  // Groups: top 3 in order, only teams that actually belong to the group.
  for (const g of GROUP_IDS) {
    const order: string[] = [];
    for (const id of p.groups[g] ?? []) {
      if (TEAMS_BY_ID[id]?.group === g && !order.includes(id)) order.push(id);
      if (order.length >= 3) break;
    }
    d.groupOrder[g] = order;
  }

  // The Round-of-32 field is derived (group top-2 + wildcards). Wildcards must be
  // teams the player actually ranked 3rd in their group. Everything downstream is
  // constrained to this field, so a team "eliminated" in the group stage can't
  // reappear in a knockout round.
  const thirds = thirdPlaceTeams(d);
  d.bestThirds = buildRound(
    (p.bestThirds ?? []).filter((id) => thirds.includes(id)),
    [],
    8,
  );
  const field = new Set([...groupAdvancers(d), ...d.bestThirds]);
  const inField = (ids: string[]) => ids.filter((id) => field.has(id));

  // Bottom-up: the named champion forces the final, the final forces the SF, etc.
  const namedChamp = p.champion && field.has(p.champion) ? [p.champion] : [];
  const final = buildRound(inField(p.final), namedChamp, ROUND_SIZE.FINAL);
  const sf = buildRound(inField(p.sf), final, ROUND_SIZE.SF);
  const qf = buildRound(inField(p.qf), sf, ROUND_SIZE.QF);
  const r16 = buildRound(inField(p.r16), qf, ROUND_SIZE.R16);
  // The champion must be one of the two finalists. If the model named none (weak
  // models sometimes skip it), fall back to the top finalist — a finalist is
  // always a plausible champion, and the player can change it in the wizard.
  const champion = namedChamp.length ? namedChamp : final.slice(0, 1);
  d.rounds = { R16: r16, QF: qf, SF: sf, FINAL: final, CHAMPION: champion };

  d.spiritTeamId = p.spirit && isValidId(p.spirit) ? p.spirit : null;
  d.finalGoals =
    p.finalGoals == null ? null : Math.max(0, Math.min(12, Math.round(p.finalGoals)));

  return d;
}

// ── Bedrock tool input schema ───────────────────────────────────────────────
// Per-group enums constrain the model to real team ids in the right group, which
// sharply cuts hallucination. Built once from the verified team data.

const allIds = TEAMS.map((t) => t.id);

const groupProps = Object.fromEntries(
  GROUP_IDS.map((g) => [
    g,
    {
      type: "array",
      description: `Group ${g} teams in predicted finishing order (1st, 2nd, 3rd).`,
      items: { type: "string", enum: teamsInGroup(g).map((t) => t.id) },
      minItems: 3,
      maxItems: 3,
    },
  ]),
);

const roundArray = (n: number, label: string) => ({
  type: "array",
  description: `The ${n} teams predicted to reach the ${label}.`,
  items: { type: "string", enum: allIds },
  minItems: n,
  maxItems: n,
});

/** JSON Schema passed to Bedrock as the propose_bracket tool's inputSchema. */
export const PROPOSE_BRACKET_INPUT_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "object",
      description: "Predicted finishing order (top 3) for each of the 12 groups.",
      properties: groupProps,
      required: GROUP_IDS,
    },
    bestThirds: {
      type: "array",
      description:
        "Exactly 8 of the twelve 3rd-place teams (must match the 3rd-place picks above) that advance to the Round of 32.",
      items: { type: "string", enum: allIds },
      minItems: 8,
      maxItems: 8,
    },
    r16: roundArray(16, "Round of 16"),
    qf: roundArray(8, "Quarterfinals"),
    sf: roundArray(4, "Semifinals"),
    final: roundArray(2, "Final"),
    champion: { type: "string", description: "The predicted champion.", enum: allIds },
    spirit: {
      type: "string",
      description: "The player's ride-or-die spirit team (any team, no money rides on it).",
      enum: allIds,
    },
    finalGoals: {
      type: "integer",
      description: "Tiebreaker: total combined goals scored in the Final (0–12).",
      minimum: 0,
      maximum: 12,
    },
  },
  required: [
    "groups",
    "bestThirds",
    "r16",
    "qf",
    "sf",
    "final",
    "champion",
    "spirit",
    "finalGoals",
  ],
} as const;
