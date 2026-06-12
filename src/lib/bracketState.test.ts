import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, cascadeTrim, backingDepth } from "./bracketState.ts";
import { scoreBracket, type Results } from "./scoring.ts";

test("backingDepth: deeper knockout picks outrank group-only, with a group tiebreak", () => {
  const d = emptyDraft();
  d.groupOrder.A = ["mex", "cze", "bra", "kor"]; // mex 1st, cze 2nd advance
  d.bestThirds = ["bra"]; // bra sneaks into the R32 field as a best third
  d.rounds = { R16: ["mex", "cze"], QF: ["mex"], SF: ["mex"], FINAL: ["mex"], CHAMPION: ["mex"] };
  const back = backingDepth(d);

  // mex carried to champion (6) + 1st-in-group (.3) is the strongest backing.
  assert.ok(back.mex > back.cze);
  assert.ok(back.cze > back.bra); // R16 (2) beats R32-only (1)
  assert.ok((back.bra ?? 0) >= 1); // in the field
  assert.equal(back.kor ?? 0, 0); // ranked 4th, didn't advance → no backing
});

// The scoring defense: a pick only counts if it's still validly reachable given
// the player's earlier picks. cascadeTrim is what enforces this; computeLeaderboard
// (and saveDraft) run it so an inconsistent/legacy bracket can't mis-score.
test("cascadeTrim drops a downstream pick that left the field — and it can't score", () => {
  const d = emptyDraft();
  // Group A: mex 1st, cze 2nd advance; bra ranked 3rd but NOT chosen as a
  // wildcard (bestThirds empty) → bra is not in the R32 field.
  d.groupOrder.A = ["mex", "cze", "bra"];
  // ...yet bra is sitting in the deep rounds (a stale/legacy/inconsistent state).
  d.rounds = { SF: ["bra"], FINAL: ["bra"], CHAMPION: ["bra"] };

  const clean = cascadeTrim(d);
  assert.deepEqual(clean.rounds.SF ?? [], []); // trimmed: bra isn't reachable

  const r: Results = { groupResults: {}, roundTeams: { SF: ["bra"] }, finalGoals: null };
  // Scoring the cleaned draft gives bra nothing...
  assert.equal(scoreBracket(clean, r).knockoutPoints, 0);
  // ...whereas the raw, un-cleaned draft WOULD have wrongly counted it.
  assert.ok(scoreBracket(d, r).knockoutPoints > 0);
});
