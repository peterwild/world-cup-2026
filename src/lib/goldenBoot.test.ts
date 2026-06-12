import { test } from "node:test";
import assert from "node:assert/strict";
import {
  goldenBootPot,
  resolveGoldenBoot,
  firstR32Kickoff,
  type GoldenBootEntry,
} from "./goldenBoot.ts";
import type { MatchFeed } from "./matches.ts";

const BUY_IN = 2000;

function entry(p: Partial<GoldenBootEntry> & { playerId: string }): GoldenBootEntry {
  return { status: "in", pickId: "gb-haaland", paid: true, ...p };
}

test("pot counts only opted-in players who have a pick", () => {
  const entries: GoldenBootEntry[] = [
    entry({ playerId: "a" }),
    entry({ playerId: "b" }),
    entry({ playerId: "c", status: "declined" }), // declined — not in pot
    entry({ playerId: "d", pickId: null }), // opted in but no pick yet — not in pot
  ];
  assert.equal(goldenBootPot(entries, BUY_IN), 2 * BUY_IN);
});

test("split: correct pickers share the pot evenly", () => {
  const entries: GoldenBootEntry[] = [
    entry({ playerId: "a", pickId: "gb-kane" }),
    entry({ playerId: "b", pickId: "gb-kane" }),
    entry({ playerId: "c", pickId: "gb-mbappe" }),
    entry({ playerId: "d", pickId: "gb-haaland" }),
  ];
  const r = resolveGoldenBoot(entries, "gb-kane", BUY_IN);
  assert.equal(r.potCents, 4 * BUY_IN);
  assert.deepEqual(r.winnerIds.sort(), ["a", "b"]);
  assert.equal(r.refund, false);
  assert.equal(r.perPlayerCents, (4 * BUY_IN) / 2); // 4000 each
});

test("single correct picker takes the whole pot", () => {
  const entries: GoldenBootEntry[] = [
    entry({ playerId: "a", pickId: "gb-mbappe" }),
    entry({ playerId: "b", pickId: "gb-kane" }),
    entry({ playerId: "c", pickId: "gb-kane" }),
  ];
  const r = resolveGoldenBoot(entries, "gb-mbappe", BUY_IN);
  assert.deepEqual(r.winnerIds, ["a"]);
  assert.equal(r.perPlayerCents, 3 * BUY_IN);
  assert.equal(r.refund, false);
});

test("nobody correct → refund flag, each gets their buy-in back", () => {
  const entries: GoldenBootEntry[] = [
    entry({ playerId: "a", pickId: "gb-kane" }),
    entry({ playerId: "b", pickId: "gb-mbappe" }),
  ];
  const r = resolveGoldenBoot(entries, "gb-haaland", BUY_IN);
  assert.equal(r.refund, true);
  assert.deepEqual(r.winnerIds, []);
  assert.equal(r.perPlayerCents, BUY_IN); // refund = your buy-in back
});

test("uneven split floors the per-winner cents (remainder settled by hand)", () => {
  const entries: GoldenBootEntry[] = [
    entry({ playerId: "a", pickId: "gb-kane" }),
    entry({ playerId: "b", pickId: "gb-kane" }),
    entry({ playerId: "c", pickId: "gb-kane" }),
  ];
  // 3 × 2000 = 6000 over 3 winners = exactly 2000; make it uneven instead:
  const r = resolveGoldenBoot(entries, "gb-kane", 2500);
  assert.equal(r.potCents, 7500);
  assert.equal(r.perPlayerCents, 2500);
});

test("firstR32Kickoff: derives from the earliest R32 kickoff in the feed", () => {
  const feed: MatchFeed = {
    played: [],
    upcoming: [
      { home: "bra", away: "eng", utcDate: "2026-06-30T19:00:00Z", stage: "LAST_32", group: null, status: "SCHEDULED" },
      { home: "fra", away: "esp", utcDate: "2026-06-29T16:00:00Z", stage: "LAST_32", group: null, status: "SCHEDULED" },
      { home: "ger", away: "ned", utcDate: "2026-06-26T18:00:00Z", stage: "GROUP_STAGE", group: "E", status: "SCHEDULED" },
    ],
    fetchedAt: "2026-06-25T00:00:00Z",
  };
  assert.equal(firstR32Kickoff(feed), "2026-06-29T16:00:00Z");
});

test("firstR32Kickoff: null when no R32 fixtures are known yet", () => {
  const feed: MatchFeed = {
    played: [],
    upcoming: [
      { home: "ger", away: "ned", utcDate: "2026-06-26T18:00:00Z", stage: "GROUP_STAGE", group: "E", status: "SCHEDULED" },
    ],
    fetchedAt: "2026-06-25T00:00:00Z",
  };
  assert.equal(firstR32Kickoff(feed), null);
});
