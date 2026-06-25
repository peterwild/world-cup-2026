// ─────────────────────────────────────────────────────────────────────────────
// "Why did my odds move?" — the per-entry explanation attached to each odds
// recompute. Two halves, deliberately kept separate so the line can never lie:
//
//   • The NUMBERS are exact, straight off the sim: winProbDelta and pointsDelta
//     are (new − previous) for this entry. No estimation.
//   • The DRIVERS are ground truth, not attribution guesswork: we diff the real
//     Results between the two snapshots to see which teams newly advanced or got
//     knocked out, then keep only the ones THIS player actually backed
//     (backingDepth). So "Brazil into the quarters" appears on your line because
//     Brazil really advanced AND you really picked them — both checkable.
//
// The sign of the headline (↑/↓) carries good-vs-bad; the drivers say what
// happened. When a player's odds drifted purely from the field moving (a rival's
// pick went out) with none of their own teams involved, drivers is empty and the
// UI falls back to a generic "the field shifted" rather than inventing a reason.
// ─────────────────────────────────────────────────────────────────────────────

import type { Results } from "./scoring";
import type { DraftBracket } from "./bracketState";
import type { EntryOdds } from "./analytics";
import { backingDepth } from "./bracketState";
import { KNOCKOUT_ROUNDS, ROUND_POINTS, ROUND_SIZE, type KnockoutRound } from "./tournament";
import { TEAMS_BY_ID } from "./teams";

export interface EntryDelta {
  /** Signed change in P(win pool) since the previous snapshot. */
  winProbDelta: number;
  /** Gain in banked points since the previous snapshot, floored at 0. Banked
   *  points are monotonic in reality — a correct pick can't be un-earned — so a
   *  negative would only ever come from a results CORRECTION (e.g. clearing a
   *  bad feed-derived reach), which isn't news. We report it as 0. */
  pointsDelta: number;
  /** Human reason fragments, most important first, capped at 2. Empty when
   *  nothing about THIS player's bracket resolved (odds may still have drifted
   *  from the field — the UI handles that case). */
  drivers: string[];
  /** Change in leaderboard position by banked points since the previous
   *  snapshot. Positive = climbed (e.g. +3 = up three places), negative =
   *  slipped, 0 = held. Optional: absent on snapshots cached before this
   *  shipped, and on a first-time entrant with no prior to diff. */
  rankDelta?: number;
}

/** Competition rank by banked points (1 = most). Ties share a rank — two tied
 *  for the most are both 1, the next is 3. Matches lib/analytics.pointsRank. */
function rankByPoints(entries: EntryOdds[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    const above = entries.filter((x) => x.currentTotal > e.currentTotal).length;
    m.set(e.id, above + 1);
  }
  return m;
}

const teamName = (id: string): string => TEAMS_BY_ID[id]?.name ?? id;

/** How to say a team "reached" a given round, in the player's voice. */
function reachedPhrase(team: string, round: KnockoutRound): string {
  switch (round) {
    case "R32":
      return `${teamName(team)} into the knockouts`;
    case "R16":
      return `${teamName(team)} into the Round of 16`;
    case "QF":
      return `${teamName(team)} into the quarters`;
    case "SF":
      return `${teamName(team)} into the semis`;
    case "FINAL":
      return `${teamName(team)} into the final`;
    case "CHAMPION":
      return `${teamName(team)} won the cup 🏆`;
  }
}

/** Teams newly present in each round's `roundTeams` between two Results. */
function newlyReached(prev: Results, next: Results): { team: string; round: KnockoutRound }[] {
  const out: { team: string; round: KnockoutRound }[] = [];
  for (const round of KNOCKOUT_ROUNDS) {
    const before = new Set(prev.roundTeams[round] ?? []);
    for (const team of next.roundTeams[round] ?? []) {
      if (!before.has(team)) out.push({ team, round });
    }
  }
  return out;
}

/** Knockout rounds (R16+) that just FILLED — i.e. became fully decided between
 *  the two snapshots. A team a player nominated to reach a now-complete round
 *  that isn't in it was knocked out, exactly. (R32/group eliminations are noisy
 *  — many ways to miss a group — so we name advances there, not exits.) */
const ELIMINATION_ROUNDS: KnockoutRound[] = ["R16", "QF", "SF", "FINAL", "CHAMPION"];
function newlyCompleteRounds(prev: Results, next: Results): KnockoutRound[] {
  return ELIMINATION_ROUNDS.filter((round) => {
    const size = ROUND_SIZE[round];
    const wasComplete = (prev.roundTeams[round]?.length ?? 0) >= size;
    const nowComplete = (next.roundTeams[round]?.length ?? 0) >= size;
    return !wasComplete && nowComplete;
  });
}

/** Build one entry's drivers from the diffed Results + the player's bracket.
 *  Exported for direct testing. */
export function entryDrivers(
  draft: DraftBracket,
  advanced: { team: string; round: KnockoutRound }[],
  completedRounds: KnockoutRound[],
  next: Results,
): string[] {
  const backed = backingDepth(draft); // teamId → how deep this player backed it
  const isMine = (team: string) => backed[team] !== undefined;

  // Candidate drivers carry a weight so a Final result outranks an R16 one.
  const cands: { weight: number; text: string }[] = [];

  // Positive: a team I backed newly reached a round.
  for (const { team, round } of advanced) {
    if (!isMine(team)) continue;
    cands.push({ weight: ROUND_POINTS[round] + 0.5, text: reachedPhrase(team, round) });
  }

  // Negative: a team I nominated to reach a now-complete round didn't make it.
  for (const round of completedRounds) {
    const reached = new Set(next.roundTeams[round] ?? []);
    for (const team of draft.rounds[round] ?? []) {
      if (!reached.has(team)) {
        cands.push({ weight: ROUND_POINTS[round], text: `${teamName(team)} knocked out` });
      }
    }
  }

  cands.sort((a, b) => b.weight - a.weight);
  // De-dupe (a champion shows once) and cap at 2 so the line stays a glance.
  const seen = new Set<string>();
  const drivers: string[] = [];
  for (const c of cands) {
    if (seen.has(c.text)) continue;
    seen.add(c.text);
    drivers.push(c.text);
    if (drivers.length === 2) break;
  }
  return drivers;
}

export interface BuildDeltasInput {
  prevEntries: EntryOdds[];
  nextEntries: EntryOdds[];
  prevActual: Results;
  nextActual: Results;
  /** id → draft, for the entries in nextEntries. */
  drafts: Map<string, DraftBracket>;
}

/** Per-entry deltas + drivers for one recompute. Numbers come from the entry
 *  diff (exact); drivers from the Results diff ∩ each player's bracket. */
export function buildEntryDeltas(input: BuildDeltasInput): Record<string, EntryDelta> {
  const prevById = new Map(input.prevEntries.map((e) => [e.id, e]));
  const advanced = newlyReached(input.prevActual, input.nextActual);
  const completed = newlyCompleteRounds(input.prevActual, input.nextActual);
  // Rank movement by banked points, prev → next. Positive = climbed.
  const prevRank = rankByPoints(input.prevEntries);
  const nextRank = rankByPoints(input.nextEntries);

  const out: Record<string, EntryDelta> = {};
  for (const e of input.nextEntries) {
    const prev = prevById.get(e.id);
    if (!prev) continue; // a new entrant since last snapshot — no baseline to diff
    const draft = input.drafts.get(e.id);
    const pr = prevRank.get(e.id);
    const nr = nextRank.get(e.id);
    out[e.id] = {
      winProbDelta: e.winProb - prev.winProb,
      // Floor at 0 — banked points never fall in reality; a drop is a correction.
      pointsDelta: Math.max(0, e.currentTotal - prev.currentTotal),
      drivers: draft ? entryDrivers(draft, advanced, completed, input.nextActual) : [],
      rankDelta: pr !== undefined && nr !== undefined ? pr - nr : 0,
    };
  }
  return out;
}
