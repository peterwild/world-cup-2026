// Seeds the local dev DB with demo players, brackets, and tournament results so
// the leaderboard can be eyeballed before the real tournament starts.
//   node --import ./scripts/ts-ext-resolver.mjs scripts/seed-demo.mjs
// Writes to data/cup.db. Wipe with: rm data/cup.db*
import { GROUP_IDS, TEAMS, teamsInGroup } from "../src/lib/teams.ts";
import { KNOCKOUT_ROUNDS, ROUND_SIZE } from "../src/lib/tournament.ts";
import { emptyDraft } from "../src/lib/bracketState.ts";
import { upsertPlayerByName, saveDraft, setResults } from "../src/lib/repo.ts";

// Deterministic "truth": each group's listed order is the finishing order.
const groupResults = {};
for (const g of GROUP_IDS) {
  const t = teamsInGroup(g);
  groupResults[g] = { first: t[0].id, second: t[1].id };
}

// R32 = 24 group qualifiers + first 8 groups' third-place team.
const advancers = GROUP_IDS.flatMap((g) => teamsInGroup(g).slice(0, 2).map((t) => t.id));
const thirds = GROUP_IDS.slice(0, 8).map((g) => teamsInGroup(g)[2].id);
const r32 = [...advancers, ...thirds];

const roundTeams = { R32: r32 };
let pool = r32;
for (const round of KNOCKOUT_ROUNDS.slice(1)) {
  pool = pool.slice(0, ROUND_SIZE[round]);
  roundTeams[round] = pool;
}
const results = { groupResults, roundTeams, finalGoals: 3 };

// A bracket that matches the truth exactly (the "perfect" entry).
function perfectDraft() {
  const d = emptyDraft();
  for (const g of GROUP_IDS) {
    const t = teamsInGroup(g);
    d.groupOrder[g] = [t[0].id, t[1].id, t[2].id];
  }
  d.bestThirds = thirds;
  for (const round of KNOCKOUT_ROUNDS.slice(1)) d.rounds[round] = roundTeams[round];
  d.spiritTeamId = roundTeams.CHAMPION[0]; // spirit team = actual champion → badge
  d.finalGoals = 3;
  return d;
}

// Nat: perfect. Dejan: perfect groups, wrong champion. Christian: weak.
const nat = perfectDraft();

const dejan = perfectDraft();
dejan.rounds.CHAMPION = [roundTeams.FINAL[1]]; // picked the losing finalist
dejan.spiritTeamId = "bra";
dejan.finalGoals = 5;

const christian = emptyDraft();
for (const g of GROUP_IDS) {
  const t = teamsInGroup(g);
  christian.groupOrder[g] = [t[3].id, t[2].id, t[1].id]; // mostly wrong order
}
christian.bestThirds = GROUP_IDS.slice(4, 12).map((g) => teamsInGroup(g)[2].id);
christian.rounds.R16 = r32.slice(8, 24);
christian.spiritTeamId = "usa";
christian.finalGoals = 1;

const people = [
  ["Nat", nat],
  ["Dejan", dejan],
  ["Christian", christian],
];
for (const [name, draft] of people) {
  const p = upsertPlayerByName(name);
  saveDraft(p.id, draft, true);
}
setResults(results);

console.log("Seeded demo: champion =", TEAMS.find((t) => t.id === roundTeams.CHAMPION[0])?.name);
console.log("Players:", people.map((p) => p[0]).join(", "), "(+ any existing)");
