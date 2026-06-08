import { test } from "node:test";
import assert from "node:assert/strict";
import type { Results } from "./scoring.ts";
import {
  knockoutPickStatus,
  groupAdvanceStatus,
  groupWinnerHit,
  r32PickStatus,
  hasAnyResults,
} from "./pickStatus.ts";

const empty: Results = { groupResults: {}, roundTeams: {}, finalGoals: null };

test("knockout: pending until the round's field is known", () => {
  assert.equal(knockoutPickStatus(empty, "SF", "fra"), "pending");
});

test("knockout: correct when the team reached the round", () => {
  const r: Results = { ...empty, roundTeams: { SF: ["fra", "bra"] } };
  assert.equal(knockoutPickStatus(r, "SF", "fra"), "correct");
});

test("knockout: missed when the round is set and the team isn't in it", () => {
  const r: Results = { ...empty, roundTeams: { SF: ["fra", "bra"] } };
  assert.equal(knockoutPickStatus(r, "SF", "esp"), "missed");
});

test("group advance: pending / correct / missed", () => {
  assert.equal(groupAdvanceStatus(empty, "A", "mex"), "pending");
  const r: Results = {
    ...empty,
    groupResults: { A: { first: "mex", second: "cze" } },
  };
  assert.equal(groupAdvanceStatus(r, "A", "mex"), "correct"); // 1st
  assert.equal(groupAdvanceStatus(r, "A", "cze"), "correct"); // 2nd
  assert.equal(groupAdvanceStatus(r, "A", "kor"), "missed");
});

test("group winner hit: only the actual first, only once settled", () => {
  assert.equal(groupWinnerHit(empty, "A", "mex"), false);
  const r: Results = {
    ...empty,
    groupResults: { A: { first: "mex", second: "cze" } },
  };
  assert.equal(groupWinnerHit(r, "A", "mex"), true);
  assert.equal(groupWinnerHit(r, "A", "cze"), false); // advanced but not winner
});

test("wildcard pick uses the R32 field", () => {
  assert.equal(r32PickStatus(empty, "kor"), "pending");
  const r: Results = { ...empty, roundTeams: { R32: ["mex", "cze", "kor"] } };
  assert.equal(r32PickStatus(r, "kor"), "correct");
  assert.equal(r32PickStatus(r, "rsa"), "missed");
});

test("hasAnyResults reflects whether the overlay should render", () => {
  assert.equal(hasAnyResults(empty), false);
  assert.equal(hasAnyResults({ ...empty, roundTeams: { R32: ["mex"] } }), true);
  assert.equal(
    hasAnyResults({ ...empty, groupResults: { A: { first: "mex", second: "cze" } } }),
    true,
  );
});
