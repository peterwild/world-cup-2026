import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_IDS } from "./teams.ts";
import { emptyResults, type Results } from "./scoring.ts";
import { bracketComplete } from "./bracketState.ts";
import { mulberry32, simulateTournament } from "./simulate.ts";
import { outcomeToDraft, simulatePool, type PoolEntry } from "./analytics.ts";

/** A "smart" bracket: one model draw — internally consistent, chalk-flavored. */
function smartEntry(id: string, seed: number): PoolEntry {
  const draft = outcomeToDraft(simulateTournament(emptyResults(), mulberry32(seed)));
  draft.spiritTeamId = "usa";
  return { id, name: id, draft };
}

/** A deliberately terrible bracket: every group order reversed from a draw. */
function dumbEntry(id: string, seed: number): PoolEntry {
  const o = simulateTournament(emptyResults(), mulberry32(seed));
  const draft = outcomeToDraft(o);
  for (const g of GROUP_IDS) draft.groupOrder[g] = [...draft.groupOrder[g]].reverse();
  // Knockout picks: ride the 3rd/4th-place teams (now "advancing") — mostly minnows.
  const field = GROUP_IDS.flatMap((g) => draft.groupOrder[g].slice(0, 2));
  draft.bestThirds = GROUP_IDS.map((g) => draft.groupOrder[g][2]).slice(0, 8);
  draft.rounds = {
    R16: field.slice(0, 16),
    QF: field.slice(0, 8),
    SF: field.slice(0, 4),
    FINAL: field.slice(0, 2),
    CHAMPION: field.slice(0, 1),
  };
  draft.spiritTeamId = "hai";
  return { id, name: id, draft };
}

test("outcomeToDraft produces a complete, valid bracket", () => {
  const o = simulateTournament(emptyResults(), mulberry32(5));
  const d = outcomeToDraft(o);
  d.spiritTeamId = "arg"; // spirit + tiebreaker are the only fields a sim lacks
  assert.ok(bracketComplete(d));
});

test("a model-consistent bracket beats a reversed one", () => {
  const pool = [smartEntry("smart", 11), dumbEntry("dumb", 12)];
  const sim = simulatePool(pool, emptyResults(), { sims: 300, population: 50, seed: 1 });

  const smart = sim.entries.find((e) => e.id === "smart")!;
  const dumb = sim.entries.find((e) => e.id === "dumb")!;
  assert.ok(smart.expectedTotal > dumb.expectedTotal, "expected points");
  assert.ok(smart.winProb > dumb.winProb, "win prob");
  assert.ok(smart.popPercentile > dumb.popPercentile, "population percentile");
});

test("win and top3 probabilities are coherent", () => {
  const pool = [smartEntry("a", 21), smartEntry("b", 22), dumbEntry("c", 23)];
  const sim = simulatePool(pool, emptyResults(), { sims: 200, population: 20, seed: 2 });

  const winSum = sim.entries.reduce((s, e) => s + e.winProb, 0);
  assert.ok(Math.abs(winSum - 1) < 1e-9, `win probs sum to 1, got ${winSum}`);
  for (const e of sim.entries) {
    assert.ok(e.winProb >= 0 && e.winProb <= 1);
    assert.ok(e.top3Prob >= e.winProb, "top3 ⊇ win");
  }
  // 3 entries → everyone is top-3 in every sim
  for (const e of sim.entries) assert.equal(e.top3Prob, 1);
});

test("team odds: monotone down the rounds, strong > weak, champs sum to 1", () => {
  const sim = simulatePool([smartEntry("x", 31)], emptyResults(), {
    sims: 300,
    population: 10,
    seed: 3,
  });
  const esp = sim.teams["esp"];
  const hai = sim.teams["hai"] ?? { reach: {}, champion: 0 };
  assert.ok((esp.reach.R32 ?? 0) > (esp.reach.QF ?? 0), "reach probs shrink by round");
  assert.ok((esp.reach.R16 ?? 0) > (hai.reach.R16 ?? 0), "esp > hai");
  assert.ok(esp.champion > hai.champion, "esp champion odds > hai");
  const champSum = Object.values(sim.teams).reduce((s, t) => s + t.champion, 0);
  assert.ok(Math.abs(champSum - 1) < 1e-9, `champion probs sum to 1, got ${champSum}`);
});

test("conditioning flows through: known champion forces the pick's win prob up", () => {
  // Two entries identical except the champion pick; reality: arg already champion.
  const base = smartEntry("argFan", 41);
  base.draft.rounds.CHAMPION = ["arg"];
  base.draft.rounds.FINAL = ["arg", base.draft.rounds.FINAL![0]].slice(0, 2);
  const rival = smartEntry("haiFan", 41); // same seed = same bracket otherwise
  rival.draft.rounds.CHAMPION = ["hai"];

  const actual: Results = { ...emptyResults(), roundTeams: { CHAMPION: ["arg"] } };
  const sim = simulatePool([base, rival], actual, { sims: 200, population: 10, seed: 4 });
  const fan = sim.entries.find((e) => e.id === "argFan")!;
  const other = sim.entries.find((e) => e.id === "haiFan")!;
  assert.ok(fan.winProb > other.winProb, "champion-correct entry must be favored");
  assert.equal(sim.teams["arg"].champion, 1, "champion conditioned to certainty");
});

test("deterministic: same seed, same numbers", () => {
  const pool = [smartEntry("a", 51), dumbEntry("b", 52)];
  const s1 = simulatePool(pool, emptyResults(), { sims: 100, population: 20, seed: 9 });
  const s2 = simulatePool(pool, emptyResults(), { sims: 100, population: 20, seed: 9 });
  assert.deepEqual(s1, s2);
});
