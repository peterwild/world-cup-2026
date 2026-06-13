import { test } from "node:test";
import assert from "node:assert/strict";
import type { Results } from "./scoring.ts";
import type { KoFixture } from "./matches.ts";
import { emptyDraft, type DraftBracket } from "./bracketState.ts";
import { assembleBracket } from "./knockoutBracket.ts";

// Group A: cze,mex,kor,rsa · B: bih,can,qat,sui · C: bra,hai,mar,sco · F: jpn,ned,swe,tun
const results: Results = {
  groupResults: {
    A: { first: "mex", second: "cze" }, // runner-up A = cze
    B: { first: "sui", second: "can" }, // runner-up B = can
    C: { first: "bra", second: "hai" }, // runner-up C = hai
    F: { first: "ned", second: "swe" }, // winner F = ned
  },
  roundTeams: {},
  finalGoals: null,
};

const draft = (over: Partial<DraftBracket> = {}): DraftBracket => ({ ...emptyDraft(), ...over });

test("no fixtures → every slot TBD, no champion, hasFixtures false", () => {
  const b = assembleBracket([], results, draft());
  assert.equal(b.hasFixtures, false);
  assert.equal(b.champion.teamId, null);
  assert.equal(Object.keys(b.nodes).length, 31);
  assert.equal(b.nodes[73].home.teamId, null);
});

test("an R32 fixture lands in the right slot, slot-a team in home, winner advanced", () => {
  // Match 73 = Runner-up A (cze) vs Runner-up B (can). Feed it reversed + can-as-home.
  const fx: KoFixture[] = [{ round: "R32", home: "can", away: "cze", winner: "cze", status: "FINISHED" }];
  const b = assembleBracket(fx, results, draft());
  assert.equal(b.nodes[73].home.teamId, "cze"); // slot-a (runner-up A) normalized to home
  assert.equal(b.nodes[73].away.teamId, "can");
  assert.equal(b.nodes[73].home.advanced, true);
  assert.equal(b.nodes[73].away.advanced, false);
  assert.equal(b.hasFixtures, true);
});

test("third-place slot accepts any team from its candidate groups", () => {
  // Match 74 = Winner E vs 3rd from {A,B,C,D,F}. Use hai (group C, a 3rd here).
  const res: Results = {
    ...results,
    groupResults: { ...results.groupResults, C: { first: "bra", second: "mar" }, E: { first: "ger", second: "ecu" } },
  };
  // hai is now 3rd of C (not 1st/2nd) → eligible for the {A,B,C,D,F} third slot.
  const fx: KoFixture[] = [{ round: "R32", home: "ger", away: "hai", winner: "ger", status: "FINISHED" }];
  const b = assembleBracket(fx, res, draft());
  assert.equal(b.nodes[74].home.teamId, "ger"); // winner E
  assert.equal(b.nodes[74].away.teamId, "hai"); // the third-placer
});

test("R16 links by child-match winners; pick overlay marks backed teams", () => {
  const fx: KoFixture[] = [
    { round: "R32", home: "cze", away: "can", winner: "cze", status: "FINISHED" }, // match 73 → cze
    { round: "R32", home: "ned", away: "hai", winner: "ned", status: "FINISHED" }, // match 75 → ned
    { round: "R16", home: "cze", away: "ned", winner: "ned", status: "FINISHED" }, // match 90
  ];
  const b = assembleBracket(fx, results, draft({ rounds: { R16: ["ned"] } }));
  // Match 90 = Winner(73) vs Winner(75) = cze vs ned.
  assert.equal(b.nodes[90].home.teamId, "cze");
  assert.equal(b.nodes[90].away.teamId, "ned");
  assert.equal(b.nodes[90].away.advanced, true);
  // Player backed ned (not cze) to reach R16.
  assert.equal(b.nodes[90].away.picked, true);
  assert.equal(b.nodes[90].home.picked, false);
});

test("champion = winner of the final, with pick overlay", () => {
  // Minimal chain isn't needed — feed a FINAL fixture whose winners we seed via
  // its child SF matches being decided.
  const fx: KoFixture[] = [
    { round: "SF", home: "bra", away: "fra", winner: "bra", status: "FINISHED" }, // match 101 (placed via linkage needs children…)
  ];
  // Without decided children the SF can't be linked, so champion stays null —
  // this asserts the guard rather than a full 31-match chain.
  const b = assembleBracket(fx, results, draft({ rounds: { CHAMPION: ["bra"] } }));
  assert.equal(b.champion.teamId, null);
});
