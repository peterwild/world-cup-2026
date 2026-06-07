// ─────────────────────────────────────────────────────────────────────────────
// Tournament structure + scoring model.
//
// We avoid a literal knockout bracket tree (the R32 pairings depend on which
// 8 best third-place teams advance — a FIFA lookup table that isn't known
// until the group stage ends). Instead each player predicts WHICH TEAMS REACH
// EACH ROUND. Points are awarded per correctly-predicted team per round.
// Robust to bracket chaos, trivial to score.
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";

/** Knockout rounds, in order. A team "reaches" a round if it plays in it. */
export type KnockoutRound = "R32" | "R16" | "QF" | "SF" | "FINAL" | "CHAMPION";

export const KNOCKOUT_ROUNDS: KnockoutRound[] = ["R32", "R16", "QF", "SF", "FINAL", "CHAMPION"];

/** How many teams a valid bracket nominates to reach each knockout round. */
export const ROUND_SIZE: Record<KnockoutRound, number> = {
  R32: 32,
  R16: 16,
  QF: 8,
  SF: 4,
  FINAL: 2,
  CHAMPION: 1,
};

// ── Scoring ──────────────────────────────────────────────────────────────────

/** Points for each team you correctly pick to advance out of its group (top 2). */
export const GROUP_ADVANCE_POINTS = 3;
/** Bonus for correctly naming the team that finishes 1st in a group. */
export const GROUP_WINNER_BONUS = 1;

/** Points per correctly-predicted team that reaches each knockout round. */
export const ROUND_POINTS: Record<KnockoutRound, number> = {
  R32: 1,
  R16: 2,
  QF: 4,
  SF: 8,
  FINAL: 12,
  CHAMPION: 20,
};

// ── Payouts ──────────────────────────────────────────────────────────────────
// 100% of the pot goes to the bracket leaderboard. Spirit Team is for fun only
// (a "Spirit Champion" trophy card + badge — no money).

/** Fraction of the pot paid to 1st / 2nd / 3rd. Must sum to 1. */
export const PAYOUT_SPLIT = [0.6, 0.3, 0.1] as const;

export function computePayouts(potCents: number): number[] {
  return PAYOUT_SPLIT.map((frac) => Math.round(potCents * frac));
}

// ── Bracket validity ─────────────────────────────────────────────────────────

/**
 * A submitted bracket. `groupPicks` is the predicted finishing order of each
 * group (slot 0 = winner ... slot 3 = last). `roundTeams` lists the team ids a
 * player predicts to REACH each knockout round.
 */
export interface Bracket {
  groupPicks: Record<GroupId, [string, string, string, string]>;
  roundTeams: Record<KnockoutRound, string[]>;
  spiritTeamId: string;
  /** tiebreaker: predicted total goals scored in the final */
  finalGoalsTiebreaker: number;
}
