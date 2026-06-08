import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft, cascadeTrim } from "./bracketState.ts";
import { scoreBracket, type Results } from "./scoring.ts";

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
