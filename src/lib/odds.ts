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

import { kvGet, kvSet, KV } from "./db";
import { getAllEntries, getResults } from "./repo";
import { bracketComplete } from "./bracketState";
import { getMatchFeed } from "./matches";
import { STAGE_TO_ROUND } from "./footballData";
import { emptyResults, type Results } from "./scoring";
import { buildEntryDeltas, type EntryDelta } from "./oddsDelta";
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
  /** computedAt of the snapshot this one replaced — "what moved since…". Null
   *  on the very first recompute (no prior to diff against). */
  prevComputedAt: string | null;
  inputHash: number;
  /** id → why this entry's odds moved vs the previous snapshot (lib/oddsDelta).
   *  Empty on the first recompute after this feature shipped (no baseline). */
  deltas: Record<string, EntryDelta>;
  /** The decided Results this snapshot was computed against — persisted so the
   *  NEXT recompute can diff it to name what resolved. Stripped from the public
   *  /api/odds payload (server-only bookkeeping). */
  actual: Results;
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
    // Only games that HAVEN'T kicked off are "upcoming to root for". A fixture
    // whose kickoff has passed is live or finished — it belongs to the live
    // strip / results, not here. `odds.rooting` carries finished games forward
    // (for the strip's finished-game verdict), so without this guard a game
    // that's already over double-shows: once in results, once as "upcoming".
    const kickoff = Date.parse(r.fixture.kickoff);
    if (kickoff <= now) continue;
    (kickoff < now + SHOW_AHEAD_MS ? games : laterGames).push(r);
  }
  return { games, laterGames };
}

// ─── Rooting lock: freeze "who to root for" at kickoff ───────────────────────
// The conditional win-probs behind each rooting recommendation are re-drawn on
// every recompute (the RNG seed re-rolls whenever any result lands), so a
// borderline call could visibly flip mid-game — or, worse, read differently in
// hindsight after full time ("you should've rooted for the other team"). We
// pin each fixture's recommendation at kickoff: it tracks the latest sim while
// the game is still upcoming, then freezes and never moves again.

/** fixtureId ("home|away|utcDate") → the rooting frozen at its kickoff. */
export type RootingLock = Record<string, FixtureRooting>;

/** Drop locked fixtures more than this past kickoff — bounds the kv row. */
const LOCK_PRUNE_MS = WATCH_AHEAD_MS; // 48h

export function getRootingLock(): RootingLock {
  return kvGet<RootingLock>(KV.rootingLock, {});
}

/**
 * Freeze each fixture's rooting at kickoff. Pure (testable): given the previous
 * lock, the fresh sim rooting, and `now`, return the rooting to SHOW plus the
 * lock to PERSIST. A fixture whose kickoff has passed serves its last
 * pre-kickoff value; one still upcoming (or first seen) takes the fresh value
 * and (re)locks it. Finished games that have left the live watch window are
 * carried forward (until pruned) so the finished-game verdict can read them.
 */
export function mergeRootingLock(
  prevLock: RootingLock,
  fresh: FixtureRooting[],
  now: number,
): { merged: FixtureRooting[]; nextLock: RootingLock } {
  const nextLock: RootingLock = {};
  // Carry forward still-relevant locked fixtures (incl. ones no longer in the
  // live sim because they finished and left the watch window).
  for (const [id, r] of Object.entries(prevLock)) {
    if (Date.parse(r.fixture.kickoff) > now - LOCK_PRUNE_MS) nextLock[id] = r;
  }
  const merged = fresh.map((r) => {
    const kicked = Date.parse(r.fixture.kickoff) <= now;
    const locked = prevLock[r.fixture.id];
    if (kicked && locked) {
      // Frozen: serve (and keep) the last pre-kickoff value.
      nextLock[r.fixture.id] = locked;
      return locked;
    }
    // Still upcoming, or first sighting — take fresh and (re)lock. Locking on
    // first sight covers a fixture that only appears after kickoff (feed lag),
    // so even then it can't flip on subsequent recomputes.
    nextLock[r.fixture.id] = r;
    return r;
  });
  return { merged, nextLock };
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

  // Freeze each fixture's rooting at kickoff (see mergeRootingLock) so the
  // recommendation can't flip once a game is underway or over.
  const { merged, nextLock } = mergeRootingLock(getRootingLock(), sim.rooting, Date.now());
  sim.rooting = merged;
  kvSet(KV.rootingLock, nextLock);

  // Why did each player's odds move? Diff this sim against the previous
  // snapshot. `cached.actual === undefined` means the prior snapshot predates
  // this feature (no diff baseline) — skip drivers that one time rather than
  // dumping the whole tournament-to-date as "what just changed".
  const hasBaseline = cached != null && cached.actual !== undefined;
  const deltas = hasBaseline
    ? buildEntryDeltas({
        prevEntries: cached.entries,
        nextEntries: sim.entries,
        prevActual: cached.actual ?? emptyResults(),
        nextActual: actual,
        drafts: new Map(entries.map((e) => [e.id, e.draft])),
      })
    : {};

  const snapshot: OddsSnapshot = {
    ...sim,
    computedAt: new Date().toISOString(),
    prevComputedAt: cached?.computedAt ?? null,
    inputHash,
    deltas,
    actual,
  };
  kvSet(ODDS_KEY, snapshot);
  return { snapshot, recomputed: true };
}
