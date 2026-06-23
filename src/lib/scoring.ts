// ─────────────────────────────────────────────────────────────────────────────
// Pure scoring engine. Takes a player's bracket + the actual tournament results
// and returns a point breakdown. No I/O — fully unit-testable.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, type GroupId } from "./teams";
import {
  GROUP_ADVANCE_POINTS,
  GROUP_WINNER_BONUS,
  KNOCKOUT_ROUNDS,
  ROUND_POINTS,
  type KnockoutRound,
} from "./tournament";
import { r32Field, type DraftBracket } from "./bracketState";

/** Actual outcomes, filled by the score poller (or an admin override). */
export interface Results {
  /** Each group's actual 1st/2nd finishers. Absent until a group completes. */
  groupResults: Partial<Record<GroupId, { first: string; second: string }>>;
  /** Teams that actually REACHED each knockout round (incl. R32 and CHAMPION).
   *  CHAMPION holds the single winner. */
  roundTeams: Partial<Record<KnockoutRound, string[]>>;
  /** Actual combined goals in the final — for the leaderboard tiebreaker. */
  finalGoals: number | null;
}

export function emptyResults(): Results {
  return { groupResults: {}, roundTeams: {}, finalGoals: null };
}

/** Forward-only merge of a freshly-derived Results onto the stored one. The
 *  free-tier feed can return a partial/flapped poll where a completed group's
 *  matches momentarily don't all read FINISHED — deriveResults is stateless, so
 *  that snapshot would UN-complete the group and claw back already-banked points
 *  (seen live: a "−3 pts" swing on a card). Reality is monotonic: a decided
 *  group never un-decides, a team that reached a round stays reached, the final
 *  once played is played. So we never regress —
 *    • groupResults: a group already set is frozen (its top-2 are final); only
 *      newly-completed groups are added.
 *    • roundTeams: union per round — a reached team is never dropped.
 *    • finalGoals: sticky once known.
 *  Same design as the forward-only status workflow + kickoff-locked rooting.
 *  Genuine corrections go through the admin route's explicit replace path. */
export function mergeResults(prev: Results, next: Results): Results {
  const groupResults = { ...next.groupResults, ...prev.groupResults };

  const roundTeams: Results["roundTeams"] = {};
  for (const round of KNOCKOUT_ROUNDS) {
    const union = [...new Set([...(prev.roundTeams[round] ?? []), ...(next.roundTeams[round] ?? [])])];
    if (union.length) roundTeams[round] = union;
  }

  return {
    groupResults,
    roundTeams,
    finalGoals: prev.finalGoals ?? next.finalGoals,
  };
}

export interface ScoreBreakdown {
  groupPoints: number;
  knockoutPoints: number;
  total: number;
  byRound: Partial<Record<KnockoutRound, number>>;
  correctChampion: boolean;
  /** Spirit team won the Cup — earns the badge, no points. */
  spiritChampion: boolean;
}

export function championOf(r: Results): string | null {
  return r.roundTeams.CHAMPION?.[0] ?? null;
}

export function scoreBracket(d: DraftBracket, r: Results): ScoreBreakdown {
  // ── Group stage: +3 per correct top-2 finisher, +1 for the correct winner ──
  let groupPoints = 0;
  for (const g of GROUP_IDS) {
    const actual = r.groupResults[g];
    if (!actual) continue;
    const advancers = (d.groupOrder[g] ?? []).slice(0, 2);
    const actualAdvancers = [actual.first, actual.second];
    for (const t of advancers) {
      if (actualAdvancers.includes(t)) groupPoints += GROUP_ADVANCE_POINTS;
    }
    if ((d.groupOrder[g] ?? [])[0] === actual.first) groupPoints += GROUP_WINNER_BONUS;
  }

  // ── Knockout: per team correctly predicted to REACH each round ─────────────
  const byRound: Partial<Record<KnockoutRound, number>> = {};
  let knockoutPoints = 0;
  for (const round of KNOCKOUT_ROUNDS) {
    const actual = r.roundTeams[round];
    if (!actual) continue;
    const predicted = round === "R32" ? r32Field(d) : (d.rounds[round] ?? []);
    let pts = 0;
    for (const t of predicted) {
      if (actual.includes(t)) pts += ROUND_POINTS[round];
    }
    byRound[round] = pts;
    knockoutPoints += pts;
  }

  const champ = championOf(r);
  const correctChampion = !!champ && d.rounds.CHAMPION?.[0] === champ;
  const spiritChampion = !!champ && d.spiritTeamId === champ;

  return {
    groupPoints,
    knockoutPoints,
    total: groupPoints + knockoutPoints,
    byRound,
    correctChampion,
    spiritChampion,
  };
}

/** Tiebreaker distance: how far the player's final-goals guess was from actual.
 *  Lower wins. null when the final hasn't been played (no actual yet). */
export function tiebreakDistance(d: DraftBracket, r: Results): number | null {
  if (r.finalGoals === null || d.finalGoals === null) return null;
  return Math.abs(d.finalGoals - r.finalGoals);
}
