import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeRootingLock, currentRooting, type RootingLock } from "./odds.ts";
import type { FixtureRooting } from "./analytics.ts";

// A minimal rooting object. `rec` is P(win | home) for player "me": rec > 0.5
// means "root for home". mergeRootingLock never inspects outcomes — only the
// fixture id + kickoff — so this is enough to prove which value is served.
function fr(id: string, kickoff: string, rec: number): FixtureRooting {
  return {
    fixture: { id, home: "jpn", away: "ned", kind: "group", kickoff, status: "SCHEDULED" },
    outcomes: [
      { outcome: "home", prob: 0.5, winProb: { me: rec } },
      { outcome: "away", prob: 0.5, winProb: { me: 1 - rec } },
    ],
  };
}

const NOW = Date.parse("2026-06-14T12:00:00Z");
const PAST = "2026-06-14T10:00:00Z"; // kicked off 2h ago (inside prune window)
const FUTURE = "2026-06-15T10:00:00Z"; // hasn't kicked off
const me = (r: FixtureRooting) => r.outcomes[0].winProb.me;

test("rooting freezes at kickoff but keeps updating while upcoming", () => {
  // First recompute: nothing locked yet — both take their fresh value.
  const first = mergeRootingLock({}, [fr("p", PAST, 0.6), fr("u", FUTURE, 0.6)], NOW);

  // Next recompute, dice re-rolled so the fresh recommendation flips (0.6→0.3).
  const second = mergeRootingLock(
    first.nextLock,
    [fr("p", PAST, 0.3), fr("u", FUTURE, 0.3)],
    NOW,
  );
  const past = second.merged.find((r) => r.fixture.id === "p")!;
  const upcoming = second.merged.find((r) => r.fixture.id === "u")!;

  assert.equal(me(past), 0.6, "kicked-off fixture stays pinned to its pre-kickoff value");
  assert.equal(me(upcoming), 0.3, "still-upcoming fixture tracks the latest sim");
});

test("a fixture first seen after kickoff locks on first sight", () => {
  // Never had a pre-kickoff value (feed lag): lock whatever we first compute…
  const first = mergeRootingLock({}, [fr("late", PAST, 0.7)], NOW);
  assert.equal(me(first.merged[0]), 0.7);
  // …and never let it move afterwards.
  const second = mergeRootingLock(first.nextLock, [fr("late", PAST, 0.2)], NOW);
  assert.equal(me(second.merged[0]), 0.7);
});

test("currentRooting: a kicked-off (finished/live) game is NOT shown as upcoming", () => {
  // Regression: odds.rooting carries finished games forward for the live-strip
  // verdict; they must not double-show in the "who to root for in upcoming
  // games" card. Anything with a past kickoff is excluded from both buckets.
  const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
  const HOUR = 3600 * 1000;
  const { games, laterGames } = currentRooting([
    fr("over", iso(-2 * HOUR), 0.6), // finished 2h ago — must be dropped
    fr("soon", iso(3 * HOUR), 0.6), // upcoming within 26h → games
    fr("later", iso(40 * HOUR), 0.6), // upcoming but far off → laterGames
  ]);
  const ids = [...games, ...laterGames].map((r) => r.fixture.id);
  assert.ok(!ids.includes("over"), "a game that already kicked off is not 'upcoming'");
  assert.deepEqual(games.map((r) => r.fixture.id), ["soon"]);
  assert.deepEqual(laterGames.map((r) => r.fixture.id), ["later"]);
});

test("finished games are retained for the verdict, then pruned", () => {
  // A finished game leaves the live watch window, so it's absent from `fresh`;
  // its locked value must survive (the finished-game verdict reads it).
  const recent: RootingLock = { p: fr("p", PAST, 0.6) };
  const kept = mergeRootingLock(recent, [], NOW);
  assert.ok(kept.nextLock.p, "recently-finished fixture is carried forward");

  // …until it ages past the prune horizon (>48h past kickoff).
  const ancient: RootingLock = { old: fr("old", "2026-06-10T10:00:00Z", 0.6) };
  const pruned = mergeRootingLock(ancient, [], NOW);
  assert.equal(pruned.nextLock.old, undefined, "stale fixture is dropped");
});
