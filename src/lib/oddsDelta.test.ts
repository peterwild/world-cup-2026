import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "./bracketState.ts";
import { emptyResults, type Results } from "./scoring.ts";
import type { EntryOdds } from "./analytics.ts";
import { TEAMS_BY_ID } from "./teams.ts";
import { entryDrivers, buildEntryDeltas } from "./oddsDelta.ts";

const name = (id: string) => TEAMS_BY_ID[id].name;

function resultsWith(roundTeams: Results["roundTeams"]): Results {
  return { groupResults: {}, roundTeams, finalGoals: null };
}

test("positive driver: a backed team newly reaching a round is named", () => {
  const d = emptyDraft();
  d.rounds = { QF: ["bra"] }; // backs Brazil to the quarters
  const drivers = entryDrivers(
    d,
    [{ team: "bra", round: "QF" }],
    [],
    resultsWith({ QF: ["bra"] }),
  );
  assert.deepEqual(drivers, [`${name("bra")} into the quarters`]);
});

test("a team you DIDN'T back advancing is not your driver", () => {
  const d = emptyDraft();
  d.rounds = { QF: ["bra"] };
  const drivers = entryDrivers(
    d,
    [{ team: "fra", round: "QF" }], // France advanced, but you didn't pick them
    [],
    resultsWith({ QF: ["fra"] }),
  );
  assert.deepEqual(drivers, []);
});

test("negative driver: a nominee missing a now-complete round is 'knocked out'", () => {
  const d = emptyDraft();
  d.rounds = { SF: ["ger"] }; // you had Germany in the semis
  const next = resultsWith({ SF: ["fra", "esp", "arg", "bra"] }); // SF full (4), no Germany
  const drivers = entryDrivers(d, [], ["SF"], next);
  assert.deepEqual(drivers, [`${name("ger")} knocked out`]);
});

test("drivers are ranked by round weight and capped at two", () => {
  const d = emptyDraft();
  d.rounds = { R16: ["bra"], CHAMPION: ["fra"], QF: ["esp"] };
  const drivers = entryDrivers(
    d,
    [
      { team: "bra", round: "R16" },
      { team: "fra", round: "CHAMPION" },
      { team: "esp", round: "QF" },
    ],
    [],
    resultsWith({ R16: ["bra"], QF: ["esp"], CHAMPION: ["fra"] }),
  );
  // Champion outranks QF outranks R16; capped at 2 → R16 drops.
  assert.deepEqual(drivers, [`${name("fra")} won the cup 🏆`, `${name("esp")} into the quarters`]);
});

test("buildEntryDeltas: numeric deltas are exact; drivers attach per bracket", () => {
  const d = emptyDraft();
  d.rounds = { QF: ["bra"] };
  const prevEntries: EntryOdds[] = [
    { id: "p1", name: "Pete", winProb: 0.1, top3Prob: 0.3, expectedTotal: 40, currentTotal: 20 },
  ];
  const nextEntries: EntryOdds[] = [
    { id: "p1", name: "Pete", winProb: 0.15, top3Prob: 0.35, expectedTotal: 45, currentTotal: 24 },
  ];
  const deltas = buildEntryDeltas({
    prevEntries,
    nextEntries,
    prevActual: emptyResults(),
    nextActual: resultsWith({ QF: ["bra"] }),
    drafts: new Map([["p1", d]]),
  });
  assert.ok(Math.abs(deltas.p1.winProbDelta - 0.05) < 1e-9);
  assert.equal(deltas.p1.pointsDelta, 4);
  assert.deepEqual(deltas.p1.drivers, [`${name("bra")} into the quarters`]);
});

test("buildEntryDeltas: a points DROP (results correction) is floored to 0, not shown as negative", () => {
  // Banked points are monotonic in reality; a fall only happens when bad results
  // are cleared (the phantom-reach cleanup). That must read as no change, not "−N pts".
  const prevEntries: EntryOdds[] = [
    { id: "p1", name: "Pete", winProb: 0.15, top3Prob: 0.3, expectedTotal: 45, currentTotal: 3 },
  ];
  const nextEntries: EntryOdds[] = [
    { id: "p1", name: "Pete", winProb: 0.14, top3Prob: 0.28, expectedTotal: 42, currentTotal: 0 },
  ];
  const deltas = buildEntryDeltas({
    prevEntries,
    nextEntries,
    prevActual: resultsWith({ R32: ["bra"] }),
    nextActual: emptyResults(),
    drafts: new Map([["p1", emptyDraft()]]),
  });
  assert.equal(deltas.p1.pointsDelta, 0);
});

test("buildEntryDeltas: a new entrant with no prior baseline is skipped", () => {
  const deltas = buildEntryDeltas({
    prevEntries: [],
    nextEntries: [
      { id: "new", name: "New", winProb: 0.1, top3Prob: 0.2, expectedTotal: 10, currentTotal: 5 },
    ],
    prevActual: emptyResults(),
    nextActual: emptyResults(),
    drafts: new Map(),
  });
  assert.equal(deltas.new, undefined);
});

test("field-only move: odds change but none of your teams resolved → no drivers", () => {
  const d = emptyDraft();
  d.rounds = { QF: ["bra"] }; // your pick, untouched this round
  const deltas = buildEntryDeltas({
    prevEntries: [
      { id: "p1", name: "Pete", winProb: 0.2, top3Prob: 0.4, expectedTotal: 50, currentTotal: 30 },
    ],
    nextEntries: [
      { id: "p1", name: "Pete", winProb: 0.18, top3Prob: 0.38, expectedTotal: 50, currentTotal: 30 },
    ],
    prevActual: resultsWith({ R16: ["fra"] }),
    nextActual: resultsWith({ R16: ["fra", "esp"] }), // a rival's team advanced, not yours
    drafts: new Map([["p1", d]]),
  });
  assert.ok(deltas.p1.winProbDelta < 0);
  assert.equal(deltas.p1.pointsDelta, 0);
  assert.deepEqual(deltas.p1.drivers, []);
});
