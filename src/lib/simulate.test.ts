import { test } from "node:test";
import assert from "node:assert/strict";
import { TEAMS } from "./teams.ts";
import { KNOCKOUT_ROUNDS, ROUND_SIZE } from "./tournament.ts";
import { emptyResults, type Results } from "./scoring.ts";
import { assertRatingsComplete, eloWinProb, expectedGoals } from "./elo.ts";
import { mulberry32, simulateTournament } from "./simulate.ts";

test("every team in teams.ts has an Elo rating", () => {
  assertRatingsComplete();
});

test("elo model sanity: favorites favored, gaps bend goals", () => {
  // Spain over Haiti should be overwhelming; equals should be a coin flip.
  assert.ok(eloWinProb(2170, 1390) > 0.97);
  assert.equal(eloWinProb(1800, 1800), 0.5);
  assert.ok(expectedGoals(2170, 1390) > expectedGoals(1390, 2170));
  // λ stays in a sane football range
  assert.ok(expectedGoals(2170, 1390) <= 4.0);
  assert.ok(expectedGoals(1390, 2170) >= 0.2);
});

test("simulated tournament has a valid shape", () => {
  const rng = mulberry32(7);
  const o = simulateTournament(emptyResults(), rng);

  // 12 groups, each with a full 4-team order and a first/second result
  assert.equal(Object.keys(o.groupOrder).length, 12);
  for (const order of Object.values(o.groupOrder)) {
    assert.equal(order.length, 4);
    assert.equal(new Set(order).size, 4);
  }
  assert.equal(Object.keys(o.results.groupResults).length, 12);
  assert.equal(o.bestThirds.length, 8);

  // Each knockout round has the right size, unique teams, nested in the prior
  let prev: string[] | null = null;
  for (const round of KNOCKOUT_ROUNDS) {
    const teams = o.results.roundTeams[round] ?? [];
    assert.equal(teams.length, ROUND_SIZE[round], `${round} size`);
    assert.equal(new Set(teams).size, teams.length, `${round} unique`);
    if (prev) {
      for (const t of teams) assert.ok(prev.includes(t), `${round}: ${t} not in prior round`);
    }
    prev = teams;
  }
  assert.equal(typeof o.results.finalGoals, "number");

  // All ids are real teams
  const ids = new Set(TEAMS.map((t) => t.id));
  for (const t of o.results.roundTeams.R32 ?? []) assert.ok(ids.has(t));
});

test("deterministic under the same seed, varies across seeds", () => {
  const a = simulateTournament(emptyResults(), mulberry32(42));
  const b = simulateTournament(emptyResults(), mulberry32(42));
  const c = simulateTournament(emptyResults(), mulberry32(43));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.results.roundTeams.CHAMPION, c.results.roundTeams.CHAMPION ?? ["~"]);
});

test("conditioning: completed group locks actual 1st/2nd", () => {
  const actual: Results = {
    ...emptyResults(),
    groupResults: { A: { first: "rsa", second: "kor" } }, // upset on purpose
  };
  const rng = mulberry32(1);
  for (let i = 0; i < 50; i++) {
    const o = simulateTournament(actual, rng);
    assert.equal(o.results.groupResults.A!.first, "rsa");
    assert.equal(o.results.groupResults.A!.second, "kor");
    assert.equal(o.groupOrder.A[0], "rsa");
    assert.equal(o.groupOrder.A[1], "kor");
  }
});

test("conditioning: known knockout reaches are locked in", () => {
  const actual: Results = {
    ...emptyResults(),
    roundTeams: { QF: ["pan", "nzl"], CHAMPION: ["pan"] }, // wild reality, still honored
  };
  const rng = mulberry32(2);
  for (let i = 0; i < 50; i++) {
    const o = simulateTournament(actual, rng);
    const qf = o.results.roundTeams.QF ?? [];
    assert.ok(qf.includes("pan"));
    assert.ok(qf.includes("nzl"));
    assert.deepEqual(o.results.roundTeams.CHAMPION, ["pan"]);
  }
});

test("conditioning: actual finalGoals honored", () => {
  const actual: Results = { ...emptyResults(), finalGoals: 5 };
  const o = simulateTournament(actual, mulberry32(3));
  assert.equal(o.results.finalGoals, 5);
});

test("strong teams advance far more often than weak ones", () => {
  const rng = mulberry32(99);
  let espR16 = 0;
  let haiR16 = 0;
  let espChamp = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const o = simulateTournament(emptyResults(), rng);
    if (o.results.roundTeams.R16?.includes("esp")) espR16++;
    if (o.results.roundTeams.R16?.includes("hai")) haiR16++;
    if (o.results.roundTeams.CHAMPION?.[0] === "esp") espChamp++;
  }
  assert.ok(espR16 / N > 0.55, `esp R16 rate ${espR16 / N}`);
  assert.ok(haiR16 / N < 0.15, `hai R16 rate ${haiR16 / N}`);
  assert.ok(espChamp / N > 0.05, `esp champion rate ${espChamp / N}`);
  assert.ok(espR16 > haiR16 * 3);
});
