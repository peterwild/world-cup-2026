import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlayedGroupMatch } from "./matches.ts";
import { groupTable } from "./groupTables.ts";

// Group A: cze, mex, kor, rsa
const m = (
  home: string,
  away: string,
  homeGoals: number,
  awayGoals: number,
): PlayedGroupMatch => ({ group: "A", home, away, homeGoals, awayGoals });

test("every group team appears even before kickoff", () => {
  const table = groupTable("A", []);
  assert.equal(table.length, 4);
  assert.deepEqual(
    table.map((r) => r.played),
    [0, 0, 0, 0],
  );
});

test("a win is 3 points, a draw is 1 each, scored both ways", () => {
  const table = groupTable("A", [m("mex", "kor", 2, 0), m("cze", "rsa", 1, 1)]);
  const mex = table.find((r) => r.teamId === "mex")!;
  const kor = table.find((r) => r.teamId === "kor")!;
  const cze = table.find((r) => r.teamId === "cze")!;
  assert.deepEqual(
    [mex.points, mex.won, mex.gf, mex.ga, mex.gd],
    [3, 1, 2, 0, 2],
  );
  assert.deepEqual([kor.points, kor.lost, kor.gd], [0, 1, -2]);
  assert.deepEqual([cze.points, cze.drawn, cze.gd], [1, 1, 0]);
});

test("sorts points → goal difference → goals for", () => {
  // mex & cze both on 3 pts; mex has the better GD, so leads.
  const table = groupTable("A", [
    m("mex", "kor", 1, 0), // mex +1
    m("cze", "rsa", 3, 1), // cze +2
  ]);
  assert.deepEqual(
    table.map((r) => r.teamId),
    ["cze", "mex", "kor", "rsa"],
  );
});

test("ignores matches from other groups", () => {
  const stray: PlayedGroupMatch = { group: "B", home: "can", away: "sui", homeGoals: 5, awayGoals: 0 };
  const table = groupTable("A", [stray]);
  assert.deepEqual(
    table.map((r) => r.played),
    [0, 0, 0, 0],
  );
});
