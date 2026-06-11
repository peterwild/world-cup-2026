import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_IDS, TEAMS } from "./teams.ts";
import { emptyResults, type Results } from "./scoring.ts";
import { bracketComplete } from "./bracketState.ts";
import { mulberry32, simulateTournament } from "./simulate.ts";
import {
  outcomeToDraft,
  simulatePool,
  spiritPulse,
  type PoolEntry,
  type WatchedFixture,
} from "./analytics.ts";

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
  const sim = simulatePool(pool, emptyResults(), { sims: 300, seed: 1 });

  const smart = sim.entries.find((e) => e.id === "smart")!;
  const dumb = sim.entries.find((e) => e.id === "dumb")!;
  assert.ok(smart.expectedTotal > dumb.expectedTotal, "expected points");
  assert.ok(smart.winProb > dumb.winProb, "win prob");
});

test("win and top3 probabilities are coherent", () => {
  const pool = [smartEntry("a", 21), smartEntry("b", 22), dumbEntry("c", 23)];
  const sim = simulatePool(pool, emptyResults(), { sims: 200, seed: 2 });

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
    sims: 300,    seed: 3,
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
  const sim = simulatePool([base, rival], actual, { sims: 200, seed: 4 });
  const fan = sim.entries.find((e) => e.id === "argFan")!;
  const other = sim.entries.find((e) => e.id === "haiFan")!;
  assert.ok(fan.winProb > other.winProb, "champion-correct entry must be favored");
  assert.equal(sim.teams["arg"].champion, 1, "champion conditioned to certainty");
});

test("spiritPulse: alive → checkpoint round; out when a decided round excludes them; champion", () => {
  const sim = simulatePool([smartEntry("a", 61)], emptyResults(), {
    sims: 200,    seed: 6,
  });

  // Pre-tournament: everyone's alive, checkpoint = making the knockouts.
  const pre = spiritPulse("esp", sim.teams, emptyResults());
  assert.ok(pre.state === "alive" && pre.nextRound === "R32" && pre.p > 0.8);

  // Fully-decided tournament: the champion is crowned, a team that never made
  // the R32 is heartbroken.
  const done = simulateTournament(emptyResults(), mulberry32(7)).results;
  const champ = done.roundTeams.CHAMPION![0];
  assert.deepEqual(spiritPulse(champ, sim.teams, done), { state: "champion" });
  const out = TEAMS.find((t) => !done.roundTeams.R32!.includes(t.id))!.id;
  assert.equal(spiritPulse(out, sim.teams, done).state, "out");

  // Partially-decided: R32 published, R16 not → an R32 team's checkpoint is R16.
  const partial: Results = { ...emptyResults(), roundTeams: { R32: done.roundTeams.R32 } };
  const mid = spiritPulse(done.roundTeams.R32![0], sim.teams, partial);
  assert.ok(mid.state === "alive" && mid.nextRound === "R16");
});

test("rooting: group fixture outcomes partition the sims, favorite favored", () => {
  const watch: WatchedFixture[] = [
    {
      id: "mex|rsa|2026-06-11T19:00:00Z",
      home: "mex",
      away: "rsa",
      kind: "group",
      kickoff: "2026-06-11T19:00:00Z",
      status: "SCHEDULED",
    },
  ];
  const sim = simulatePool([smartEntry("a", 81)], emptyResults(), {
    sims: 300,    seed: 8,
    watch,
  });
  const r = sim.rooting[0];
  assert.equal(r.fixture.id, watch[0].id);
  // Every sim plays every group match → outcome probs partition exactly.
  const probSum = r.outcomes.reduce((s, o) => s + o.prob, 0);
  assert.ok(Math.abs(probSum - 1) < 1e-9, `outcome probs sum to 1, got ${probSum}`);
  const p = Object.fromEntries(r.outcomes.map((o) => [o.outcome, o.prob]));
  assert.ok(p.home! > p.away!, "Mexico (favorite) wins more sims than South Africa");
  for (const o of r.outcomes) {
    assert.ok(o.winProb["a"] >= 0 && o.winProb["a"] <= 1);
  }
});

test("rooting: knockout fixture — each champion pick needs its team to win", () => {
  // Identical brackets except the champion pick; watch a hypothetical
  // esp-vs-arg final. Conditional on esp winning it, the esp pick banks +20
  // and must beat its twin (and vice versa).
  const espFan = smartEntry("espFan", 71);
  espFan.draft.rounds.CHAMPION = ["esp"];
  const argFan = smartEntry("argFan", 71);
  argFan.draft.rounds.CHAMPION = ["arg"];
  const watch: WatchedFixture[] = [
    {
      id: "esp|arg|2026-07-19T19:00:00Z",
      home: "esp",
      away: "arg",
      kind: "FINAL",
      kickoff: "2026-07-19T19:00:00Z",
      status: "TIMED",
    },
  ];
  const sim = simulatePool([espFan, argFan], emptyResults(), {
    sims: 400,    seed: 7,
    watch,
  });
  const r = sim.rooting[0];
  const home = r.outcomes.find((o) => o.outcome === "home")!; // esp champion
  const away = r.outcomes.find((o) => o.outcome === "away")!; // arg champion
  assert.ok(home.prob > 0 && away.prob > 0, "both outcomes occur in sims");
  assert.ok(home.winProb["espFan"] > 0.9, "esp champion ⇒ espFan wins");
  assert.ok(away.winProb["argFan"] > 0.9, "arg champion ⇒ argFan wins");
  assert.ok(home.winProb["espFan"] > away.winProb["espFan"]);
  assert.ok(away.winProb["argFan"] > home.winProb["argFan"]);
});

test("rooting: played group matches shift the conditioned odds", () => {
  // Same pool, but reality says South Africa already beat Mexico 3-0. The
  // sims that honor it should drop Mexico's group-win and champion odds.
  const pool = [smartEntry("a", 91)];
  const before = simulatePool(pool, emptyResults(), { sims: 300, seed: 10 });
  const after = simulatePool(pool, emptyResults(), {
    sims: 300,    seed: 10,
    playedGroupMatches: [
      { group: "A", home: "rsa", away: "mex", homeGoals: 3, awayGoals: 0 },
    ],
  });
  assert.ok(
    (after.teams["mex"]?.reach.R32 ?? 0) < (before.teams["mex"]?.reach.R32 ?? 0),
    "a real 0-3 loss must hurt Mexico's advance odds",
  );
  assert.ok(
    (after.teams["rsa"]?.reach.R32 ?? 0) > (before.teams["rsa"]?.reach.R32 ?? 0),
    "and help South Africa's",
  );
});

test("deterministic: same seed, same numbers", () => {
  const pool = [smartEntry("a", 51), dumbEntry("b", 52)];
  const s1 = simulatePool(pool, emptyResults(), { sims: 100, seed: 9 });
  const s2 = simulatePool(pool, emptyResults(), { sims: 100, seed: 9 });
  assert.deepEqual(s1, s2);
});
