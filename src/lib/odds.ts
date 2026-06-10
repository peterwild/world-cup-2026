// ─────────────────────────────────────────────────────────────────────────────
// Odds cache: run the Monte Carlo pool simulation on the box and store the
// output in kv, so page loads only ever READ precomputed numbers (the sim is
// seconds of CPU — far too slow for a request path).
//
// Recompute is triggered by the poll-scores workflow right after it pushes
// fresh results (see /api/admin/odds). It's cheap to over-trigger: we hash the
// inputs (results + entry set) and skip the sim when nothing changed. The seed
// derives from that same hash, so identical states always produce identical
// odds — no flicker between recomputes — while any new result reshuffles it.
// ─────────────────────────────────────────────────────────────────────────────

import { kvGet, kvSet } from "./db";
import { getAllEntries, getResults } from "./repo";
import { bracketComplete } from "./bracketState";
import { simulatePool, type PoolEntry, type PoolSimulation } from "./analytics";

const ODDS_KEY = "odds";
const SIMS = 2000;
const POPULATION = 300;

export interface OddsSnapshot extends PoolSimulation {
  computedAt: string; // ISO
  inputHash: number;
}

/** FNV-1a over a string — stable input fingerprint + deterministic seed. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pool entries, filtered exactly like the leaderboard (standings.ts): you're
 *  in once you've committed a complete bracket, and submitted_at is sticky. */
function poolEntries(): PoolEntry[] {
  return getAllEntries()
    .filter((e) => e.submittedAt !== null || bracketComplete(e.draft))
    .map((e) => ({ id: e.player.id, name: e.player.name, draft: e.draft }));
}

export function getOdds(): OddsSnapshot | null {
  return kvGet<OddsSnapshot | null>(ODDS_KEY, null);
}

/** Re-run the sim and cache it; no-op when inputs are unchanged (unless
 *  forced). Returns the live snapshot either way. */
export function recomputeOdds(force = false): { snapshot: OddsSnapshot; recomputed: boolean } {
  const entries = poolEntries();
  const actual = getResults();
  const inputHash = fnv1a(JSON.stringify({ actual, ids: entries.map((e) => e.id) }));

  const cached = getOdds();
  if (!force && cached && cached.inputHash === inputHash) {
    return { snapshot: cached, recomputed: false };
  }

  const sim = simulatePool(entries, actual, {
    sims: SIMS,
    population: POPULATION,
    seed: inputHash,
  });
  const snapshot: OddsSnapshot = {
    ...sim,
    computedAt: new Date().toISOString(),
    inputHash,
  };
  kvSet(ODDS_KEY, snapshot);
  return { snapshot, recomputed: true };
}
