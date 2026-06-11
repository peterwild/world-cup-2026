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
// 4000 (up from the launch 2000): rooting conditions on outcome buckets, so a
// ~25%-probability draw bucket still needs ~1000 sims behind it.
const SIMS = 4000;
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

  const sim = simulatePool(entries, actual, {
    sims: SIMS,
    seed: inputHash,
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
