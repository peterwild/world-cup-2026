import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KO_TEMPLATE,
  TEMPLATE_BY_MATCH,
  R32_LEAF_ORDER,
  childMatches,
  FINAL_MATCH,
} from "./knockoutTemplate.ts";

test("31 matches with the right per-round counts", () => {
  assert.equal(KO_TEMPLATE.length, 31);
  const counts: Record<string, number> = {};
  for (const tm of KO_TEMPLATE) counts[tm.round] = (counts[tm.round] ?? 0) + 1;
  assert.deepEqual(counts, { R32: 16, R16: 8, QF: 4, SF: 2, FINAL: 1 });
});

test("every matchWinner source points at a real, earlier match", () => {
  for (const tm of KO_TEMPLATE) {
    for (const side of [tm.a, tm.b]) {
      if (side.kind === "matchWinner") {
        assert.ok(TEMPLATE_BY_MATCH[side.match], `match ${tm.match} → missing ${side.match}`);
        assert.ok(side.match < tm.match, `match ${tm.match} should feed forward, not from ${side.match}`);
      }
    }
  }
});

test("R32 leaf order covers all 16 R32 matches exactly once, in bracket order", () => {
  assert.equal(R32_LEAF_ORDER.length, 16);
  assert.equal(new Set(R32_LEAF_ORDER).size, 16);
  const r32 = KO_TEMPLATE.filter((tm) => tm.round === "R32").map((tm) => tm.match);
  assert.deepEqual([...R32_LEAF_ORDER].sort((a, b) => a - b), r32.sort((a, b) => a - b));
  // First leaf walks down the left side from the final (74 per the official tree).
  assert.equal(R32_LEAF_ORDER[0], 74);
});

test("every match except the 16 R32 leaves is fed by exactly two children", () => {
  for (const tm of KO_TEMPLATE) {
    const kids = childMatches(tm.match);
    assert.equal(kids.length, tm.round === "R32" ? 0 : 2, `match ${tm.match}`);
  }
});

test("each non-final match feeds into exactly one later match", () => {
  for (const tm of KO_TEMPLATE) {
    if (tm.match === FINAL_MATCH) continue;
    const parents = KO_TEMPLATE.filter((p) => childMatches(p.match).includes(tm.match));
    assert.equal(parents.length, 1, `match ${tm.match} should have one parent`);
  }
});

test("every group's winner and runner-up appear once across the R32 slots", () => {
  const groups = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
  const winners = new Set<string>();
  const runners = new Set<string>();
  for (const tm of KO_TEMPLATE) {
    for (const side of [tm.a, tm.b]) {
      if (side.kind === "winner") winners.add(side.group);
      if (side.kind === "runnerup") runners.add(side.group);
    }
  }
  assert.deepEqual([...winners].sort(), groups);
  assert.deepEqual([...runners].sort(), groups);
});
