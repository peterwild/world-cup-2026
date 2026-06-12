// ─────────────────────────────────────────────────────────────────────────────
// Odds cache: run the Monte Carlo pool simulation on the box and store the
// output in kv, so page loads only ever READ precomputed numbers (the sim is
// seconds of CPU — far too slow for a request path).
//
// Recompute is triggered by the poll-scores workflow right after it pushes
// fresh results (see /api/admin/odds). It's cheap to over-trigger: we hash the
// inputs (results + entry set + watch window) and skip the sim when nothing
// changed.
//
// Two distinct fingerprints, deliberately:
//   • inputHash — the SKIP key. Includes the watch window, so a fixture merely
//     entering the rooting window or flipping to IN_PLAY re-runs the sim and
//     refreshes the rooting cards.
//   • oddsSeed — the RNG seed. Derived ONLY from decided results (`actual`), so
//     the Monte Carlo draw is FIXED across the whole tournament and the headline
//     championship odds move only when a real result lands — never from the
//     clock, a kickoff, or a status flip. (Pre-fix the seed was inputHash, so
//     every 20-min watch-window churn re-rolled all 4000 dice and the odds
//     visibly jittered with nothing actually decided.)
// ─────────────────────────────────────────────────────────────────────────────

import { kvGet, kvSet } from "./db";
import { getAllEntries, getResults } from "./repo";
import { bracketComplete } from "./bracketState";
import { getMatchFeed } from "./matches";
import { STAGE_TO_ROUND } from "./footballData";
import {
  simulatePool,
  type FixtureRooting,
  type PoolEntry,
  type PoolSimulation,
  type WatchedFixture,
} from "./analytics";

const ODDS_KEY = "odds";
// 10000 (up from 4000): with the seed now fixed off `actual` (see header), the
// dice no longer re-roll on every recompute, so the only residual movement is
// real-result signal — but tighter sampling still makes that movement smooth.
// ~1s on the box (synchronous, blocks the event loop), fine for a 20-min job.
const SIMS = 10000;
/** Rooting horizon: fixtures kicking off within the next 48h (or already live). */
const WATCH_AHEAD_MS = 48 * 3600 * 1000;
/** Keep a fixture watched a few hours past kickoff — covers in-play status lag. */
const WATCH_BEHIND_MS = 4 * 3600 * 1000;
const WATCH_CAP = 12;

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

/** The undecided fixtures inside the rooting window, oldest kickoff first. */
function watchedFixtures(now = Date.now()): WatchedFixture[] {
  const feed = getMatchFeed();
  return (feed?.upcoming ?? [])
    .filter((f) => {
      const t = Date.parse(f.utcDate);
      return t > now - WATCH_BEHIND_MS && t < now + WATCH_AHEAD_MS;
    })
    .flatMap((f): WatchedFixture[] => {
      const kind = f.stage === "GROUP_STAGE" ? ("group" as const) : STAGE_TO_ROUND[f.stage];
      if (!kind) return []; // unknown stage string — skip rather than guess
      return [
        {
          id: `${f.home}|${f.away}|${f.utcDate}`,
          home: f.home,
          away: f.away,
          kind,
          kickoff: f.utcDate,
          status: f.status,
        },
      ];
    })
    .slice(0, WATCH_CAP); // feed is kickoff-sorted (deriveMatches)
}

/** The rooting entries worth showing right now: live games plus kickoffs in
 *  the next ~26h; the rest land in a collapsed "more games" disclosure.
 *  Time-dependent, so it lives here — component render must stay pure. */
const SHOW_AHEAD_MS = 26 * 3600 * 1000;
export function currentRooting(rooting: FixtureRooting[]): {
  games: FixtureRooting[];
  laterGames: FixtureRooting[];
} {
  const now = Date.now();
  const games: FixtureRooting[] = [];
  const laterGames: FixtureRooting[] = [];
  for (const r of rooting) {
    const live = r.fixture.status === "IN_PLAY" || r.fixture.status === "PAUSED";
    const soon = live || Date.parse(r.fixture.kickoff) < now + SHOW_AHEAD_MS;
    (soon ? games : laterGames).push(r);
  }
  return { games, laterGames };
}

/** Re-run the sim and cache it; no-op when inputs are unchanged (unless
 *  forced). Returns the live snapshot either way. */
export function recomputeOdds(force = false): { snapshot: OddsSnapshot; recomputed: boolean } {
  const entries = poolEntries();
  const actual = getResults();
  const played = getMatchFeed()?.played ?? [];
  const watch = watchedFixtures();
  const inputHash = fnv1a(
    JSON.stringify({
      actual,
      ids: entries.map((e) => e.id),
      played,
      // id + status so a fixture entering the window OR flipping to IN_PLAY
      // triggers a recompute (status drives the "live" badge).
      watch: watch.map((w) => w.id + w.status),
    }),
  );

  const cached = getOdds();
  if (!force && cached && cached.inputHash === inputHash) {
    return { snapshot: cached, recomputed: false };
  }

  // Seed off decided results ONLY — not the entry set, the watch window, or
  // partial in-play scores — so the dice stay fixed and odds evolve purely as
  // real results accumulate. Empty `actual` (pre-tournament) → constant seed →
  // identical odds on every recompute, zero jitter.
  const oddsSeed = fnv1a(JSON.stringify(actual));
  const sim = simulatePool(entries, actual, {
    sims: SIMS,
    seed: oddsSeed,
    playedGroupMatches: played,
    watch,
  });
  const snapshot: OddsSnapshot = {
    ...sim,
    computedAt: new Date().toISOString(),
    inputHash,
  };
  kvSet(ODDS_KEY, snapshot);
  return { snapshot, recomputed: true };
}
