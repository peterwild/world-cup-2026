import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "./bracketState.ts";
import { scoreBracket, tiebreakDistance, mergeResults, type Results } from "./scoring.ts";
import { GROUP_IDS } from "./teams.ts";

// A bracket that nails Group A (mex 1st, cze 2nd) and rides France deep.
function sampleBracket() {
  const d = emptyDraft();
  d.groupOrder.A = ["mex", "cze", "kor"];
  d.groupOrder.B = ["sui", "can", "qat"];
  // R32 wildcards (thirds): pick kor (A's third)
  d.bestThirds = ["kor"];
  d.rounds = {
    R16: ["mex", "fra", "bra", "esp"],
    QF: ["mex", "fra"],
    SF: ["fra"],
    FINAL: ["fra"],
    CHAMPION: ["fra"],
  };
  d.spiritTeamId = "usa";
  d.finalGoals = 3;
  return d;
}

test("group stage: +3 per correct advancer, +1 winner bonus", () => {
  const d = emptyDraft();
  d.groupOrder.A = ["mex", "cze", "kor"]; // predicts mex 1st, cze 2nd
  const r: Results = {
    groupResults: { A: { first: "mex", second: "cze" } }, // both right, winner right
    roundTeams: {},
    finalGoals: null,
  };
  // 3 (mex advance) + 3 (cze advance) + 1 (mex winner) = 7
  assert.equal(scoreBracket(d, r).groupPoints, 7);
});

test("group stage: right teams advance but winner/runner flipped = no bonus", () => {
  const d = emptyDraft();
  d.groupOrder.A = ["mex", "cze", "kor"]; // predicts mex 1st
  const r: Results = {
    groupResults: { A: { first: "cze", second: "mex" } }, // both advanced, order flipped
    roundTeams: {},
    finalGoals: null,
  };
  // 3 + 3 advance, but winner (mex) wrong → 6
  assert.equal(scoreBracket(d, r).groupPoints, 6);
});

test("knockout: points scale by round and only for teams that actually reach", () => {
  const d = sampleBracket();
  const r: Results = {
    groupResults: {},
    roundTeams: {
      R32: ["mex", "cze", "kor", "fra", "bra"], // mex, cze, kor in player's R32 field → 3×1
      R16: ["fra", "bra"], // player had fra + bra → 2×2 = 4
      QF: ["fra"], // player had fra → 1×4 = 4
      SF: ["fra"], // fra → 8
      FINAL: ["fra"], // fra → 12
      CHAMPION: ["fra"], // fra → 20
    },
    finalGoals: 2,
  };
  const s = scoreBracket(d, r);
  // R32: mex,cze,kor reach (esp/bra in field? field = group advancers + thirds)
  // field = A:[mex,cze] B:[sui,can] + thirds[kor] = mex,cze,sui,can,kor
  // of those, R32 actual has mex,cze,kor → 3 points
  assert.equal(s.byRound.R32, 3);
  assert.equal(s.byRound.R16, 4);
  assert.equal(s.byRound.QF, 4);
  assert.equal(s.byRound.SF, 8);
  assert.equal(s.byRound.FINAL, 12);
  assert.equal(s.byRound.CHAMPION, 20);
  assert.equal(s.knockoutPoints, 3 + 4 + 4 + 8 + 12 + 20);
  assert.equal(s.correctChampion, true);
});

test("spirit champion flag only when spirit team wins the cup", () => {
  const d = sampleBracket(); // spirit = usa
  const champFra: Results = { groupResults: {}, roundTeams: { CHAMPION: ["fra"] }, finalGoals: null };
  assert.equal(scoreBracket(d, champFra).spiritChampion, false);

  d.spiritTeamId = "fra";
  assert.equal(scoreBracket(d, champFra).spiritChampion, true);
});

test("tiebreak distance is absolute, null until final played", () => {
  const d = sampleBracket(); // finalGoals = 3
  assert.equal(tiebreakDistance(d, { groupResults: {}, roundTeams: {}, finalGoals: 5 }), 2);
  assert.equal(tiebreakDistance(d, { groupResults: {}, roundTeams: {}, finalGoals: null }), null);
});

test("empty results → zero score, no crash", () => {
  const s = scoreBracket(sampleBracket(), { groupResults: {}, roundTeams: {}, finalGoals: null });
  assert.equal(s.total, 0);
  assert.equal(s.correctChampion, false);
});

const allGroupsDecided = (): Results["groupResults"] =>
  Object.fromEntries(
    GROUP_IDS.map((g) => [g, { first: `${g}1`, second: `${g}2` }]),
  ) as Results["groupResults"];

test("mergeResults: a flapped poll can't un-complete a group", () => {
  const prev: Results = {
    groupResults: { A: { first: "ARG", second: "MEX" } },
    roundTeams: {},
    finalGoals: null,
  };
  // The next poll came back partial — group A no longer reads complete.
  const flapped: Results = { groupResults: {}, roundTeams: {}, finalGoals: null };
  assert.deepEqual(mergeResults(prev, flapped).groupResults, { A: { first: "ARG", second: "MEX" } });
});

test("mergeResults: a stale knockout projection self-heals mid-group-stage", () => {
  // A projected R32 reach got frozen in earlier; the group stage isn't over, so
  // the (status-gated) derived poll has none — the stale one must NOT persist.
  const prev: Results = { groupResults: {}, roundTeams: { R32: ["nor"] }, finalGoals: null };
  const clean: Results = { groupResults: {}, roundTeams: {}, finalGoals: null };
  assert.equal(mergeResults(prev, clean).roundTeams.R32, undefined);
});

test("mergeResults: once the group stage is decided, knockout reaches are sticky", () => {
  const groups = allGroupsDecided();
  const prev: Results = { groupResults: groups, roundTeams: { R16: ["bra"] }, finalGoals: null };
  // A partial poll drops the real R16 reach — group stage complete, so the union
  // keeps it (protects banked knockout points from a feed flap).
  const flapped: Results = { groupResults: groups, roundTeams: {}, finalGoals: null };
  assert.deepEqual(mergeResults(prev, flapped).roundTeams.R16, ["bra"]);
});

test("mergeResults: forward progress still lands (new group, finalGoals)", () => {
  const prev: Results = {
    groupResults: { A: { first: "ARG", second: "MEX" } },
    roundTeams: {},
    finalGoals: null,
  };
  const next: Results = {
    groupResults: { B: { first: "FRA", second: "SEN" } },
    roundTeams: {},
    finalGoals: 3,
  };
  const merged = mergeResults(prev, next);
  assert.deepEqual(merged.groupResults, {
    A: { first: "ARG", second: "MEX" },
    B: { first: "FRA", second: "SEN" },
  });
  assert.equal(merged.finalGoals, 3);
});

test("mergeResults: a completed group's top-2 is frozen, not overwritten", () => {
  const prev: Results = {
    groupResults: { A: { first: "ARG", second: "MEX" } },
    roundTeams: {},
    finalGoals: null,
  };
  // A later poll disagrees on the order — reality doesn't change a decided group,
  // so prev wins (a genuine fix uses the admin replace path).
  const next: Results = {
    groupResults: { A: { first: "MEX", second: "ARG" } },
    roundTeams: {},
    finalGoals: null,
  };
  assert.deepEqual(mergeResults(prev, next).groupResults.A, { first: "ARG", second: "MEX" });
});
