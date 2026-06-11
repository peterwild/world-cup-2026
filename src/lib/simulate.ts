// ─────────────────────────────────────────────────────────────────────────────
// Single-tournament Monte Carlo simulator. Given the actual Results so far
// (possibly empty), produce ONE complete plausible tournament outcome — a full
// Results object plus the group detail (full finishing orders + best thirds)
// that Results doesn't carry. Pure + deterministic under a seeded rng; no I/O.
//
// Conditioning is at Results granularity (what the box actually stores):
//   • a completed group locks its actual 1st/2nd; 3rd/4th are re-simulated
//     (Results drops them — only matters for best-thirds in the short window
//     between a group finishing and the real R32 being published)
//   • teams known to have reached a knockout round are locked into it
//   • a partially-known round simulates only its remaining slots; a team that
//     actually lost is still treated as alive until its round completes —
//     coarse, but converges to truth as the poller fills Results in
//
// Knockout pairings are RANDOM within each round (the app deliberately has no
// bracket tree — see tournament.ts). This slightly flattens favorites' odds
// (they can meet early). Encode FIFA's R32 grid later if we want sharper odds.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, teamsInGroup, type GroupId } from "./teams";
import { KNOCKOUT_ROUNDS, ROUND_SIZE } from "./tournament";
import type { Results } from "./scoring";
import type { PlayedGroupMatch } from "./matches";
import {
  eloOf,
  sampleScore,
  sampleKnockoutAWins,
  samplePoisson,
  sampleGaussian,
  RATING_NOISE_SIGMA,
} from "./elo";
import { TEAMS } from "./teams";

// ── Seeded RNG (mulberry32) — reproducible sims, no deps ────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Output shape ─────────────────────────────────────────────────────────────

/** One simulated tournament: the Results the scorer consumes, plus the group
 *  detail needed to build synthetic brackets (analytics.ts). */
export interface SimOutcome {
  results: Results;
  /** Full 4-team finishing order per group. */
  groupOrder: Record<GroupId, string[]>;
  /** The 8 third-place teams that advanced to the R32. */
  bestThirds: string[];
}

export interface SimulateOptions {
  /** Already-played group matches: their real scores are baked into every
   *  simulated table instead of being re-sampled — mid-group conditioning at
   *  match granularity (finer than Results' completed-groups-only). */
  fixedGroupMatches?: PlayedGroupMatch[];
  /** Called once per group match per sim (fixed or sampled), in the sim's
   *  home/away orientation. Lets analytics bucket sims by a watched fixture's
   *  outcome — "who to root for" without re-running the sim per hypothesis. */
  recordGroupMatch?: (home: string, away: string, homeGoals: number, awayGoals: number) => void;
}

// ── Group stage ──────────────────────────────────────────────────────────────

interface GroupRow {
  pts: number;
  gd: number;
  gf: number;
}

/** Simulate one group's 6-match round-robin; return finishing order + table.
 *  Matches present in `fixed` (keyed "home|away") use their real score. */
function simulateGroup(
  group: GroupId,
  known: { first: string; second: string } | undefined,
  rng: () => number,
  rating: (id: string) => number,
  fixed: Map<string, { homeGoals: number; awayGoals: number }>,
  record?: SimulateOptions["recordGroupMatch"],
): { order: string[]; table: Record<string, GroupRow> } {
  const ids = teamsInGroup(group).map((t) => t.id);
  const table: Record<string, GroupRow> = Object.fromEntries(
    ids.map((id) => [id, { pts: 0, gd: 0, gf: 0 }]),
  );
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      // Honor a real result in either orientation; sample the rest.
      let homeGoals: number;
      let awayGoals: number;
      const fwd = fixed.get(`${ids[i]}|${ids[j]}`);
      const rev = fwd ? undefined : fixed.get(`${ids[j]}|${ids[i]}`);
      if (fwd) ({ homeGoals, awayGoals } = fwd);
      else if (rev) ({ homeGoals: awayGoals, awayGoals: homeGoals } = rev);
      else ({ homeGoals, awayGoals } = sampleScore(rating(ids[i]), rating(ids[j]), rng));
      record?.(ids[i], ids[j], homeGoals, awayGoals);
      const h = table[ids[i]];
      const a = table[ids[j]];
      h.gf += homeGoals;
      h.gd += homeGoals - awayGoals;
      a.gf += awayGoals;
      a.gd += awayGoals - homeGoals;
      if (homeGoals > awayGoals) h.pts += 3;
      else if (awayGoals > homeGoals) a.pts += 3;
      else {
        h.pts += 1;
        a.pts += 1;
      }
    }
  }
  // pts / gd / gf, residual ties by rng coin — mirrors footballData's sort.
  const order = [...ids].sort(
    (x, y) =>
      table[y].pts - table[x].pts ||
      table[y].gd - table[x].gd ||
      table[y].gf - table[x].gf ||
      (rng() < 0.5 ? -1 : 1),
  );
  if (!known) return { order, table };
  // Group already decided in reality: force actual 1st/2nd, keep the simulated
  // relative order of the rest (their table rows still rank the thirds pool).
  const rest = order.filter((id) => id !== known.first && id !== known.second);
  return { order: [known.first, known.second, ...rest], table };
}

// ── Knockout rounds ──────────────────────────────────────────────────────────

/** Fill one knockout round: lock the teams known to have reached it, then play
 *  random pairings among the remaining field until the round is full. */
function advanceRound(
  field: string[],
  size: number,
  known: string[],
  rng: () => number,
  rating: (id: string) => number,
): string[] {
  const locked = [...new Set(known)].slice(0, size);
  const winners = [...locked];
  let pool = shuffle(
    field.filter((id) => !locked.includes(id)),
    rng,
  );
  // Each locked team consumed an opponent we can't identify (no pairings in
  // Results) — drop one random pool team per locked slot to keep the field
  // size honest, except when that would starve the remaining slots.
  const mustKeep = (size - winners.length) * 2;
  pool = pool.slice(0, Math.max(mustKeep, pool.length - locked.length));
  while (winners.length < size && pool.length >= 2) {
    const a = pool.pop()!;
    const b = pool.pop()!;
    winners.push(sampleKnockoutAWins(rating(a), rating(b), rng) ? a : b);
  }
  while (winners.length < size && pool.length > 0) winners.push(pool.pop()!); // bye
  return winners;
}

// ── Full tournament ──────────────────────────────────────────────────────────

export function simulateTournament(
  actual: Results,
  rng: () => number,
  opts: SimulateOptions = {},
): SimOutcome {
  // Per-sim effective ratings: base Elo + N(0, σ) noise. Models rating
  // uncertainty + tournament-to-tournament form; without it the favorite's
  // championship odds compound to ~2x what real markets price.
  const effective: Record<string, number> = {};
  for (const t of TEAMS) {
    effective[t.id] = eloOf(t.id) + RATING_NOISE_SIGMA * sampleGaussian(rng);
  }
  const rating = (id: string) => effective[id] ?? eloOf(id);

  // Real played-match scores, keyed "home|away" in feed orientation.
  const fixed = new Map<string, { homeGoals: number; awayGoals: number }>();
  for (const m of opts.fixedGroupMatches ?? []) {
    fixed.set(`${m.home}|${m.away}`, { homeGoals: m.homeGoals, awayGoals: m.awayGoals });
  }

  // Group stage
  const groupOrder = {} as Record<GroupId, string[]>;
  const tables: Record<string, GroupRow> = {};
  for (const g of GROUP_IDS) {
    const { order, table } = simulateGroup(
      g,
      actual.groupResults[g],
      rng,
      rating,
      fixed,
      opts.recordGroupMatch,
    );
    groupOrder[g] = order;
    Object.assign(tables, table);
  }

  // Best thirds: rank the 12 third-place teams by their simulated table rows.
  const thirds = GROUP_IDS.map((g) => groupOrder[g][2]).sort(
    (x, y) =>
      tables[y].pts - tables[x].pts ||
      tables[y].gd - tables[x].gd ||
      tables[y].gf - tables[x].gf ||
      (rng() < 0.5 ? -1 : 1),
  );
  const bestThirds = thirds.slice(0, 8);

  // R32 field = group top-2 + best thirds, with known reaches forced in.
  const knownR32 = actual.roundTeams.R32 ?? [];
  const derivedR32 = [...GROUP_IDS.flatMap((g) => groupOrder[g].slice(0, 2)), ...bestThirds];
  const r32 = [
    ...new Set([...knownR32, ...derivedR32]),
  ].slice(0, ROUND_SIZE.R32);

  // Knockout: each round's survivors come from the previous round's field.
  const roundTeams: Results["roundTeams"] = { R32: r32 };
  let field = r32;
  for (const round of KNOCKOUT_ROUNDS.slice(1)) {
    field = advanceRound(field, ROUND_SIZE[round], actual.roundTeams[round] ?? [], rng, rating);
    roundTeams[round] = field;
  }

  // Final goals (tiebreaker): replay the final between the two finalists for a
  // goal count consistent with the model; honor the actual once it exists.
  let finalGoals = actual.finalGoals;
  if (finalGoals === null) {
    const [a, b] = roundTeams.FINAL ?? [];
    if (a && b) {
      const ft = sampleScore(rating(a), rating(b), rng);
      finalGoals = ft.homeGoals + ft.awayGoals;
      // level after 90 → some finals add ET goals
      if (ft.homeGoals === ft.awayGoals) finalGoals += samplePoisson(0.7, rng);
    } else {
      finalGoals = 0;
    }
  }
  // Champion must be one of the finalists; respect a known champion.
  const champ = actual.roundTeams.CHAMPION?.[0] ?? roundTeams.CHAMPION?.[0] ?? null;
  if (champ) roundTeams.CHAMPION = [champ];

  // Group results for the scorer: actual where known, simulated otherwise.
  const groupResults: Results["groupResults"] = {};
  for (const g of GROUP_IDS) {
    groupResults[g] = actual.groupResults[g] ?? {
      first: groupOrder[g][0],
      second: groupOrder[g][1],
    };
  }

  return { results: { groupResults, roundTeams, finalGoals }, groupOrder, bestThirds };
}
