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
// "Who should I root for" doesn't re-run the sim per hypothesis — it BUCKETS
// the scoring sims by each watched fixture's simulated outcome and reads
// conditional win probs straight out of the buckets. One pass, every game.
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";
import { KNOCKOUT_ROUNDS, ROUND_SIZE, type KnockoutRound } from "./tournament";
import { emptyResults, scoreBracket, type Results } from "./scoring";
import type { DraftBracket } from "./bracketState";
import type { PlayedGroupMatch } from "./matches";
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

// ── Rooting interest ─────────────────────────────────────────────────────────

/** An undecided real fixture worth conditioning on. */
export interface WatchedFixture {
  /** Stable id: "home|away|utcDate". */
  id: string;
  home: string;
  away: string;
  /** "group" for group-stage games, else the knockout round the match is in. */
  kind: "group" | KnockoutRound;
  /** ISO kickoff. */
  kickoff: string;
  /** SCHEDULED | TIMED | IN_PLAY | PAUSED — for the "live now" badge. */
  status: string;
}

export type RootingOutcomeKey = "home" | "draw" | "away";

export interface RootingOutcome {
  outcome: RootingOutcomeKey;
  /** P(this outcome) across the scoring sims. */
  prob: number;
  /** entry id → P(win the pool | this outcome). */
  winProb: Record<string, number>;
}

export interface FixtureRooting {
  fixture: WatchedFixture;
  /** Outcomes that occurred in ≥1 sim. Group games: home/draw/away. Knockout
   *  games: home/away, conditioned on which team reaches the next round (sims
   *  where both or neither do are uninformative and excluded — probs may not
   *  sum to 1). */
  outcomes: RootingOutcome[];
}

export interface PoolSimulation {
  entries: EntryOdds[];
  teams: Record<string, TeamOdds>;
  rooting: FixtureRooting[];
  sims: number;
  population: number;
}

export interface SimulatePoolOptions {
  /** Conditioned scoring sims. */
  sims?: number;
  /** Synthetic population size (unconditioned sims-as-brackets). */
  population?: number;
  seed?: number;
  /** Real played group matches — conditions sims at match granularity. */
  playedGroupMatches?: PlayedGroupMatch[];
  /** Undecided fixtures to compute rooting interest for. */
  watch?: WatchedFixture[];
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

  // ── Rooting setup: watch lookup, per-sim recorder, outcome buckets ──
  const watch = opts.watch ?? [];
  const OUTCOME_INDEX: Record<RootingOutcomeKey, number> = { home: 0, draw: 1, away: 2 };
  const NEXT_ROUND: Partial<Record<KnockoutRound, KnockoutRound>> = {
    R32: "R16", R16: "QF", QF: "SF", SF: "FINAL", FINAL: "CHAMPION",
  };
  // Group fixtures are matched by team pair in either orientation (the sim's
  // round-robin doesn't track real home/away).
  const groupWatch = new Map<string, { f: number; flip: boolean }>();
  watch.forEach((w, f) => {
    if (w.kind !== "group") return;
    groupWatch.set(`${w.home}|${w.away}`, { f, flip: false });
    groupWatch.set(`${w.away}|${w.home}`, { f, flip: true });
  });
  const simGroupOutcome = new Array<RootingOutcomeKey | undefined>(watch.length);
  const recordGroupMatch = groupWatch.size
    ? (home: string, away: string, hg: number, ag: number) => {
        const hit = groupWatch.get(`${home}|${away}`);
        if (!hit) return;
        simGroupOutcome[hit.f] =
          hg === ag ? "draw" : (hg > ag) !== hit.flip ? "home" : "away";
      }
    : undefined;
  const bucketCount = watch.map(() => [0, 0, 0]);
  const bucketCredit = watch.map(() => [
    new Float64Array(n), new Float64Array(n), new Float64Array(n),
  ]);
  const winShare = new Array<number>(n); // per-sim scratch: this sim's win split

  const simOpts = { fixedGroupMatches: opts.playedGroupMatches, recordGroupMatch };
  const rng = mulberry32(seed);
  for (let s = 0; s < sims; s++) {
    simGroupOutcome.fill(undefined);
    const outcome = simulateTournament(actual, rng, simOpts);
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
    winShare.fill(0);
    if (scored.length > 0) {
      const lead = scored[0];
      const winners = scored.filter((x) => x.total === lead.total && x.tb === lead.tb);
      for (const w of winners) winShare[w.idx] = 1 / winners.length;
      for (const x of scored.slice(0, 3)) top3Credit[x.idx] += 1;
    }
    for (let i = 0; i < n; i++) winCredit[i] += winShare[i];
    for (const x of scored) totalSum[x.idx] += x.total;

    // Rooting buckets: file this sim's win shares under each watched fixture's
    // simulated outcome.
    for (let f = 0; f < watch.length; f++) {
      const w = watch[f];
      let key = simGroupOutcome[f];
      if (w.kind !== "group") {
        const next = NEXT_ROUND[w.kind];
        const reached = next ? (r.roundTeams[next] ?? []) : [];
        const h = reached.includes(w.home);
        const a = reached.includes(w.away);
        if (h !== a) key = h ? "home" : "away"; // both/neither → uninformative
      }
      if (!key) continue;
      const oi = OUTCOME_INDEX[key];
      bucketCount[f][oi]++;
      const credit = bucketCredit[f][oi];
      for (let i = 0; i < n; i++) credit[i] += winShare[i];
    }

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

  const rooting: FixtureRooting[] = watch.map((w, f) => {
    const keys: RootingOutcomeKey[] =
      w.kind === "group" ? ["home", "draw", "away"] : ["home", "away"];
    const outcomes: RootingOutcome[] = [];
    for (const key of keys) {
      const oi = OUTCOME_INDEX[key];
      const count = bucketCount[f][oi];
      if (count === 0) continue; // never happened in any sim
      const winProb: Record<string, number> = {};
      entries.forEach((e, i) => {
        winProb[e.id] = bucketCredit[f][oi][i] / count;
      });
      outcomes.push({ outcome: key, prob: count / sims, winProb });
    }
    return { fixture: w, outcomes };
  });

  return { entries: entryOdds, teams, rooting, sims, population };
}

// ── Heartbreak meter ─────────────────────────────────────────────────────────
// The spirit team's pulse: alive (💗/💓 by survival odds), out (💔), or
// champion (🏆 — the leaderboard already crowns that separately). Only 1 of 48
// spirit teams survives; near-universal heartbreak is the feature.

export type SpiritPulse =
  | { state: "champion" }
  | { state: "out" }
  /** Still in it: p = P(surviving its next undecided round). */
  | { state: "alive"; p: number; nextRound: KnockoutRound };

export function spiritPulse(
  teamId: string,
  teams: Record<string, TeamOdds>,
  actual: Results,
): SpiritPulse {
  if (actual.roundTeams.CHAMPION?.[0] === teamId) return { state: "champion" };
  // Walk the rounds in order; the first one reality hasn't fully decided yet
  // is the team's next survival checkpoint. (Results granularity: a team that
  // lost mid-round reads "alive" until its round completes — same coarseness
  // as simulate.ts, converges as the poller fills Results in.)
  for (const round of KNOCKOUT_ROUNDS) {
    const known = actual.roundTeams[round] ?? [];
    if (known.length >= ROUND_SIZE[round]) {
      if (!known.includes(teamId)) return { state: "out" };
      continue; // made it through this round
    }
    return { state: "alive", p: teams[teamId]?.reach[round] ?? 0, nextRound: round };
  }
  return { state: "out" }; // tournament fully decided and they aren't champion
}
