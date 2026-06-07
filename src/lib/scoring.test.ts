import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "./bracketState.ts";
import { scoreBracket, tiebreakDistance, type Results } from "./scoring.ts";

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
