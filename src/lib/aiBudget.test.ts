import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MODELS,
  MODEL_KEYS,
  isModelKey,
  costCents,
  remainingCents,
  isOverBudget,
} from "./aiBudget.ts";

test("costCents: opus is priced from its tariff", () => {
  // 2000 in + 800 out on Opus = 2*0.8 + 0.8*3.2 = 1.6 + 2.56 = $4.16 = 416c
  assert.equal(costCents("opus", { inputTokens: 2000, outputTokens: 800 }), 416);
});

test("costCents: haiku is far cheaper than opus for the same usage", () => {
  const usage = { inputTokens: 2000, outputTokens: 800 };
  assert.ok(costCents("haiku", usage) < costCents("sonnet", usage));
  assert.ok(costCents("sonnet", usage) < costCents("opus", usage));
});

test("strategic squeeze: ~$50 buys roughly 10 Opus turns / 90 Haiku turns", () => {
  // A representative mid-conversation turn.
  const turn = { inputTokens: 2500, outputTokens: 700 };
  const opusTurns = Math.floor(5000 / costCents("opus", turn));
  const haikuTurns = Math.floor(5000 / costCents("haiku", turn));
  assert.ok(opusTurns >= 8 && opusTurns <= 13, `opus turns=${opusTurns}`);
  assert.ok(haikuTurns >= 70, `haiku turns=${haikuTurns}`);
});

test("costCents: cached input (fewer input tokens) costs the player less", () => {
  const cold = costCents("sonnet", { inputTokens: 4000, outputTokens: 600 });
  const warm = costCents("sonnet", { inputTokens: 400, outputTokens: 600 });
  assert.ok(warm < cold);
});

test("remainingCents never goes negative on an overrun", () => {
  assert.equal(remainingCents(5000, 5200), 0);
  assert.equal(remainingCents(5000, 1500), 3500);
});

test("isOverBudget triggers at exactly the budget", () => {
  assert.equal(isOverBudget(5000, 4999), false);
  assert.equal(isOverBudget(5000, 5000), true);
  assert.equal(isOverBudget(5000, 6000), true);
});

test("isModelKey guards arbitrary input", () => {
  assert.ok(isModelKey("opus"));
  assert.ok(!isModelKey("gpt-4"));
  assert.ok(!isModelKey(null));
  assert.deepEqual(MODEL_KEYS.sort(), ["haiku", "opus", "sonnet"]);
  for (const k of MODEL_KEYS) assert.ok(MODELS[k].id.includes("anthropic"));
});
