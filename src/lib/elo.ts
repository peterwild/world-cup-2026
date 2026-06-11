// ─────────────────────────────────────────────────────────────────────────────
// Team strength model: Elo ratings + a Poisson-goals match model.
//
// Ratings are a STATIC SNAPSHOT from eloratings.net (World Football Elo),
// fetched pre-tournament. They feed the Monte Carlo simulator (simulate.ts) —
// they are inputs to odds, never to scoring, so a stale rating can never
// affect anyone's points. Refresh with scripts/refresh-elo.mjs (--write).
//
// Match model: each side's expected goals scale with the Elo gap, then goals
// are sampled as independent Poissons. Draws fall out naturally (~26% between
// equals — right for WC group play). Knockout ties resolve by an Elo-weighted
// coin (ET/pens abstracted away). No host home-advantage in v1.
// ─────────────────────────────────────────────────────────────────────────────

import { TEAMS } from "./teams";

/** Approximate World-Football-Elo snapshot, pre-tournament 2026. */
export const ELO: Record<string, number> = {
  // Group A
  cze: 1740, mex: 1875, kor: 1758, rsa: 1517,
  // Group B
  bih: 1595, can: 1788, qat: 1421, sui: 1891,
  // Group C
  bra: 1991, hai: 1548, mar: 1827, sco: 1782,
  // Group D
  aus: 1777, par: 1834, tur: 1911, usa: 1726,
  // Group E
  cuw: 1434, ecu: 1938, ger: 1932, civ: 1695,
  // Group F
  jpn: 1906, ned: 1948, swe: 1712, tun: 1628,
  // Group G
  bel: 1894, egy: 1696, irn: 1772, nzl: 1562,
  // Group H
  cpv: 1578, ksa: 1576, esp: 2157, uru: 1892,
  // Group I
  fra: 2063, irq: 1607, nor: 1914, sen: 1860,
  // Group J
  alg: 1772, arg: 2115, aut: 1830, jor: 1680,
  // Group K
  col: 1982, cod: 1652, por: 1989, uzb: 1714,
  // Group L
  cro: 1912, eng: 2024, gha: 1510, pan: 1730,
};

export function eloOf(teamId: string): number {
  const r = ELO[teamId];
  if (r === undefined) throw new Error(`No Elo rating for team "${teamId}"`);
  return r;
}

/** Every team in teams.ts must have a rating — checked by tests too. */
export function assertRatingsComplete(): void {
  for (const t of TEAMS) eloOf(t.id);
}

// ── Match model ──────────────────────────────────────────────────────────────

/** Combined-goals baseline per side and how hard the Elo gap bends it.
 *  GOAL_SLOPE is deliberately softer than raw Elo expectancy: football is
 *  low-scoring and one-off matches compress favorites' realized win rates.
 *  Calibrated (with RATING_NOISE_SIGMA) so the pre-tournament favorite's
 *  championship odds land near what real winner markets price (~15-20%),
 *  not the ~35% a literal static-Elo compounding produces. */
const BASE_GOALS = 1.3;
const GOAL_SLOPE = 1450; // Elo points per 10x goal ratio

/** Expected goals for side A against side B. */
export function expectedGoals(eloA: number, eloB: number): number {
  const lambda = BASE_GOALS * Math.pow(10, (eloA - eloB) / GOAL_SLOPE);
  return Math.min(4.0, Math.max(0.2, lambda));
}

/** Standard Elo win expectancy — used for knockout tie resolution. */
export function eloWinProb(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 400));
}

/** Poisson sample via Knuth — fine for λ ≤ 4. */
export function samplePoisson(lambda: number, rng: () => number): number {
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

export interface MatchScore {
  homeGoals: number;
  awayGoals: number;
}

/** One 90-minute result between two RATINGS, goals from paired Poissons.
 *  Takes numbers (not ids) so the simulator can pass noise-adjusted ratings. */
export function sampleScore(eloA: number, eloB: number, rng: () => number): MatchScore {
  return {
    homeGoals: samplePoisson(expectedGoals(eloA, eloB), rng),
    awayGoals: samplePoisson(expectedGoals(eloB, eloA), rng),
  };
}

/** Knockout: play 90 minutes; if level, Elo-weighted coin for ET/pens.
 *  Returns true when side A advances. */
export function sampleKnockoutAWins(eloA: number, eloB: number, rng: () => number): boolean {
  const { homeGoals, awayGoals } = sampleScore(eloA, eloB, rng);
  if (homeGoals !== awayGoals) return homeGoals > awayGoals;
  return rng() < eloWinProb(eloA, eloB);
}

// ── Rating uncertainty ───────────────────────────────────────────────────────
// A static Elo treated as exact makes the sim far too top-heavy (compounding
// over 7 rounds gave the favorite ~35% to win — real markets price ~15-18%).
// Each simulated tournament perturbs every team's rating by N(0, σ): "our
// rating is an estimate, and form varies tournament to tournament."

export const RATING_NOISE_SIGMA = 100;

/** Standard normal via Box–Muller. */
export function sampleGaussian(rng: () => number): number {
  const u = Math.max(rng(), Number.MIN_VALUE); // avoid log(0)
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
