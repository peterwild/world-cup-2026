import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUP_IDS, teamsInGroup, TEAMS_BY_ID } from "./teams.ts";
import { bracketComplete, r32Field } from "./bracketState.ts";
import { proposalToDraft, ProposalSchema } from "./aiProposal.ts";

/** Build an internally-consistent full proposal straight from the team data. */
function validProposal() {
  const groups = Object.fromEntries(
    GROUP_IDS.map((g) => [g, teamsInGroup(g).slice(0, 3).map((t) => t.id)]),
  );
  const advancers = GROUP_IDS.flatMap((g) => groups[g].slice(0, 2)); // 24
  const thirds = GROUP_IDS.map((g) => groups[g][2]); // 12
  const bestThirds = thirds.slice(0, 8);
  const r32 = [...advancers, ...bestThirds]; // 32
  const r16 = r32.slice(0, 16);
  const qf = r16.slice(0, 8);
  const sf = qf.slice(0, 4);
  const final = sf.slice(0, 2);
  return {
    groups,
    bestThirds,
    r16,
    qf,
    sf,
    final,
    champion: final[0],
    spirit: "usa",
    finalGoals: 3,
  };
}

test("a valid full proposal maps to a complete bracket", () => {
  const d = proposalToDraft(validProposal());
  assert.ok(bracketComplete(d), "expected a complete bracket");
  assert.equal(r32Field(d).length, 32);
  assert.equal(d.rounds.CHAMPION?.length, 1);
  assert.equal(d.spiritTeamId, "usa");
  assert.equal(d.finalGoals, 3);
});

test("hallucinated team ids are dropped, not crashed on", () => {
  const p = validProposal();
  p.champion = "atlantis";
  p.spirit = "narnia";
  p.bestThirds = [...p.bestThirds.slice(0, 7), "wakanda"]; // one bogus
  const d = proposalToDraft(p);
  assert.equal(d.rounds.CHAMPION?.length, 0); // bogus champion dropped
  assert.equal(d.spiritTeamId, null);
  assert.ok(!d.bestThirds.includes("wakanda"));
});

test("a team placed in the wrong group is rejected", () => {
  const p = validProposal();
  const a = teamsInGroup("A")[0].id;
  // shove a Group A team into Group B's order — must be dropped
  p.groups.B = [a, ...p.groups.B.slice(0, 2)];
  const d = proposalToDraft(p);
  assert.ok(!d.groupOrder.B.includes(a));
  assert.ok(d.groupOrder.B.every((id) => TEAMS_BY_ID[id].group === "B"));
});

test("a deep pick missing from earlier rounds is propagated UP, not dropped", () => {
  // Mirrors a real model error: a finalist the model forgot to list in the SF.
  // Reaching the final means you reached every earlier round, so we add it back.
  const p = validProposal();
  const finalist = p.final[1]; // a legit field team in the final...
  p.sf = p.sf.filter((id) => id !== finalist); // ...but model dropped it from SF
  p.sf.push(p.qf.find((id) => !p.sf.includes(id))!); // keep SF at 4 distinct
  const d = proposalToDraft(p);
  assert.ok(d.rounds.FINAL?.includes(finalist), "finalist kept");
  assert.ok(d.rounds.SF?.includes(finalist), "finalist propagated up into SF");
  // Nesting is guaranteed: champion ⊆ final ⊆ sf ⊆ qf ⊆ r16.
  assert.equal(d.rounds.FINAL?.length, 2);
  assert.equal(d.rounds.SF?.length, 4);
  assert.ok(d.rounds.FINAL!.every((id) => d.rounds.SF!.includes(id)));
  assert.ok(d.rounds.SF!.every((id) => d.rounds.QF!.includes(id)));
});

test("a knockout team that didn't advance from its group can't sneak in", () => {
  const p = validProposal();
  // 4th-place team in Group A (never ranked, so not in the field) shoved into SF
  const eliminated = teamsInGroup("A").find((t) => !p.groups.A.includes(t.id))!.id;
  p.final = [eliminated, p.final[0]];
  const d = proposalToDraft(p);
  assert.ok(!d.rounds.FINAL?.includes(eliminated), "non-advancing team rejected");
});

test("a partial / empty proposal parses without throwing", () => {
  assert.doesNotThrow(() => proposalToDraft({}));
  assert.doesNotThrow(() => proposalToDraft(undefined));
  // champion with no supporting Final is trimmed away (consistency), but the
  // tiebreaker still parses + clamps and nothing throws.
  const d = proposalToDraft({ champion: "bra", finalGoals: 99 });
  assert.equal(d.rounds.CHAMPION?.length, 0);
  assert.equal(d.finalGoals, 12); // clamped
});

test("ProposalSchema tolerates missing arrays via defaults", () => {
  const parsed = ProposalSchema.parse({ champion: "fra" });
  assert.deepEqual(parsed.bestThirds, []);
  assert.equal(parsed.champion, "fra");
});
