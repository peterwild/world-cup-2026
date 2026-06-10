// ─────────────────────────────────────────────────────────────────────────────
// Monte Carlo pool analytics. Runs many simulated tournaments (simulate.ts),
// re-scores every entry against each one (scoring.ts), and aggregates:
//   • per-entry: P(win pool), P(top 3), expected final points, current points,
//     percentile vs a synthetic population of brackets
//   • per-team: P(reach each round), P(champion) — feeds the heartbreak meter
//     (spirit teams) and the rooting views
//
// Pure — callers fetch entries/results and decide caching. Two sim streams:
//   scoring sims  — conditioned on actual Results (the future from HERE)
//   population    — UNconditioned sims turned into brackets. They model people
//     who filled out a bracket before lock; conditioning them would hand them
//     perfect hindsight on completed groups and poison the percentiles.
//
// "Who should I root for" = run this twice with a hypothesis baked into the
// conditioned Results (e.g. team X reaches R16) and diff the win probs.
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";
import { KNOCKOUT_ROUNDS, type KnockoutRound } from "./tournament";
import { emptyResults, scoreBracket, type Results } from "./scoring";
import type { DraftBracket } from "./bracketState";
import { mulberry32, simulateTournament, type SimOutcome } from "./simulate";

export interface PoolEntry {
  id: string;
  name: string;
  draft: DraftBracket;
}

export interface EntryOdds {
  id: string;
  name: string;
  /** P(finish #1 in the pool), ties split. */
  winProb: number;
  /** P(finish in the top 3 — the paid places). */
  top3Prob: number;
  /** Mean final total across sims. */
  expectedTotal: number;
  /** Points already banked against the actual Results. */
  currentTotal: number;
  /** Percentile of expectedTotal within the synthetic population (0–100). */
  popPercentile: number;
  /** Percentile of currentTotal within the synthetic population (0–100). */
  popPercentileCurrent: number;
}

export interface TeamOdds {
  /** P(team reaches each knockout round). */
  reach: Partial<Record<KnockoutRound, number>>;
  /** P(team wins the whole thing). */
  champion: number;
}

export interface PoolSimulation {
  entries: EntryOdds[];
  teams: Record<string, TeamOdds>;
  sims: number;
  population: number;
}

export interface SimulatePoolOptions {
  /** Conditioned scoring sims. */
  sims?: number;
  /** Synthetic population size (unconditioned sims-as-brackets). */
  population?: number;
  seed?: number;
}

/** A simulated tournament re-read as the bracket of someone who "called it" —
 *  the building block of the synthetic population. */
export function outcomeToDraft(o: SimOutcome): DraftBracket {
  const rounds: Partial<Record<KnockoutRound, string[]>> = {};
  for (const r of ["R16", "QF", "SF", "FINAL", "CHAMPION"] as KnockoutRound[]) {
    rounds[r] = [...(o.results.roundTeams[r] ?? [])];
  }
  return {
    groupOrder: Object.fromEntries(
      Object.entries(o.groupOrder).map(([g, order]) => [g, [...order]]),
    ) as Record<GroupId, string[]>,
    bestThirds: [...o.bestThirds],
    rounds,
    spiritTeamId: null,
    finalGoals: o.results.finalGoals,
  };
}

export function simulatePool(
  entries: PoolEntry[],
  actual: Results,
  opts: SimulatePoolOptions = {},
): PoolSimulation {
  const sims = opts.sims ?? 1000;
  const population = opts.population ?? 200;
  const seed = opts.seed ?? 20260611;

  // ── Synthetic population: unconditioned brackets (see header) ──
  const popRng = mulberry32(seed ^ 0x9e3779b9);
  const popDrafts = Array.from({ length: population }, () =>
    outcomeToDraft(simulateTournament(emptyResults(), popRng)),
  );

  // ── Accumulators ──
  const n = entries.length;
  const winCredit = new Array<number>(n).fill(0);
  const top3Credit = new Array<number>(n).fill(0);
  const totalSum = new Array<number>(n).fill(0);
  const popTotalSum = new Array<number>(population).fill(0);
  const reachCounts: Record<string, Partial<Record<KnockoutRound, number>>> = {};
  const champCounts: Record<string, number> = {};

  const rng = mulberry32(seed);
  for (let s = 0; s < sims; s++) {
    const outcome = simulateTournament(actual, rng);
    const r = outcome.results;

    // Team reach/champion tallies
    for (const round of KNOCKOUT_ROUNDS) {
      for (const id of r.roundTeams[round] ?? []) {
        const rc = (reachCounts[id] ??= {});
        rc[round] = (rc[round] ?? 0) + 1;
      }
    }
    const champ = r.roundTeams.CHAMPION?.[0];
    if (champ) champCounts[champ] = (champCounts[champ] ?? 0) + 1;

    // Score the real entries and rank them like the live leaderboard does
    // (total desc, tiebreak asc with nulls last) — residual ties get a random
    // jitter per sim so credit is unbiased across sims.
    const scored = entries.map((e, idx) => {
      const total = scoreBracket(e.draft, r).total;
      const tb =
        e.draft.finalGoals === null || r.finalGoals === null
          ? null
          : Math.abs(e.draft.finalGoals - r.finalGoals);
      return { idx, total, tb, jitter: rng() };
    });
    scored.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (a.tb !== b.tb) {
        if (a.tb === null) return 1;
        if (b.tb === null) return -1;
        return a.tb - b.tb;
      }
      return a.jitter - b.jitter;
    });
    if (scored.length > 0) {
      const lead = scored[0];
      const winners = scored.filter((x) => x.total === lead.total && x.tb === lead.tb);
      for (const w of winners) winCredit[w.idx] += 1 / winners.length;
      for (const x of scored.slice(0, 3)) top3Credit[x.idx] += 1;
    }
    for (const x of scored) totalSum[x.idx] += x.total;

    // Population brackets ride along as ghosts (their totals only).
    for (let p = 0; p < population; p++) {
      popTotalSum[p] += scoreBracket(popDrafts[p], r).total;
    }
  }

  // ── Aggregate ──
  const popExpected = popTotalSum.map((t) => t / sims);
  const popCurrent = popDrafts.map((d) => scoreBracket(d, actual).total);

  const percentile = (value: number, among: number[]): number => {
    if (among.length === 0) return 50;
    let below = 0;
    let equal = 0;
    for (const x of among) {
      if (x < value) below++;
      else if (x === value) equal++;
    }
    return (100 * (below + 0.5 * equal)) / among.length;
  };

  const entryOdds: EntryOdds[] = entries.map((e, i) => {
    const expectedTotal = sims > 0 ? totalSum[i] / sims : 0;
    const currentTotal = scoreBracket(e.draft, actual).total;
    return {
      id: e.id,
      name: e.name,
      winProb: sims > 0 ? winCredit[i] / sims : 0,
      top3Prob: sims > 0 ? top3Credit[i] / sims : 0,
      expectedTotal,
      currentTotal,
      popPercentile: percentile(expectedTotal, popExpected),
      popPercentileCurrent: percentile(currentTotal, popCurrent),
    };
  });

  const teams: Record<string, TeamOdds> = {};
  for (const [id, rc] of Object.entries(reachCounts)) {
    const reach: Partial<Record<KnockoutRound, number>> = {};
    for (const round of KNOCKOUT_ROUNDS) {
      if (rc[round] !== undefined) reach[round] = rc[round]! / sims;
    }
    teams[id] = { reach, champion: (champCounts[id] ?? 0) / sims };
  }

  return { entries: entryOdds, teams, sims, population };
}
