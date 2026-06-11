import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveMatches,
  deriveResults,
  groupsFromMatches,
  nameToId,
  type FdMatch,
} from "./footballData.ts";

test("nameToId handles aliases and our own names", () => {
  assert.equal(nameToId("Korea Republic"), "kor");
  assert.equal(nameToId("IR Iran"), "irn");
  assert.equal(nameToId("United States"), "usa");
  assert.equal(nameToId("Brazil"), "bra");
  assert.equal(nameToId("Nowhereland"), null);
});

function group(home: string, away: string, h: number, a: number, g = "A"): FdMatch {
  return {
    stage: "GROUP_STAGE",
    group: `GROUP_${g}`,
    status: "FINISHED",
    homeTeam: { name: home },
    awayTeam: { name: away },
    score: {
      winner: h > a ? "HOME_TEAM" : a > h ? "AWAY_TEAM" : "DRAW",
      fullTime: { home: h, away: a },
    },
  };
}

test("group standings order by points then goal diff", () => {
  // Mexico beats both others; Czechia edges South Korea on the head result.
  const matches = [
    group("Mexico", "Czechia", 2, 0),
    group("Mexico", "South Korea", 1, 0),
    group("Czechia", "South Korea", 3, 1),
  ];
  const { results } = deriveResults(matches);
  assert.deepEqual(results.groupResults.A, { first: "mex", second: "cze" });
});

test("groupsFromMatches reads the feed's group assignments", () => {
  const matches: FdMatch[] = [
    group("Mexico", "Czechia", 0, 0),
    group("South Korea", "South Africa", 0, 0),
  ];
  const { groups, unmapped } = groupsFromMatches(matches);
  assert.deepEqual(groups.A, ["cze", "kor", "mex", "rsa"]);
  assert.deepEqual(unmapped, []);
});

test("group not finalized until all its matches are played", () => {
  const matches: FdMatch[] = [
    group("Mexico", "Czechia", 2, 0), // finished
    { ...group("Mexico", "South Korea", 0, 0), status: "SCHEDULED" }, // not played
  ];
  const { results } = deriveResults(matches);
  assert.equal(results.groupResults.A, undefined);
});

test("knockout reaches + champion from FINAL", () => {
  const ko = (stage: string, home: string, away: string, h = 1, a = 0): FdMatch => ({
    stage,
    group: null,
    status: "FINISHED",
    homeTeam: { name: home },
    awayTeam: { name: away },
    score: { winner: h > a ? "HOME_TEAM" : "AWAY_TEAM", fullTime: { home: h, away: a } },
  });
  const matches = [
    ko("LAST_32", "Brazil", "Haiti"),
    ko("LAST_16", "Brazil", "Spain"),
    ko("FINAL", "France", "Brazil", 2, 1),
  ];
  const { results } = deriveResults(matches);
  assert.deepEqual(results.roundTeams.R32?.sort(), ["bra", "hai"]);
  assert.ok(results.roundTeams.R16?.includes("bra"));
  assert.deepEqual(results.roundTeams.CHAMPION, ["fra"]);
  assert.equal(results.finalGoals, 3);
});

test("reports unmapped names instead of guessing", () => {
  const { unmapped } = deriveResults([group("Mexico", "Madeupistan", 1, 0)]);
  assert.deepEqual(unmapped, ["Madeupistan"]);
});

test("deriveMatches: played group matches vs upcoming fixtures, kickoff-sorted", () => {
  const matches: FdMatch[] = [
    { ...group("Mexico", "Czechia", 2, 0), utcDate: "2026-06-11T19:00:00Z" }, // finished → played
    {
      ...group("South Korea", "South Africa", 0, 0),
      status: "TIMED",
      utcDate: "2026-06-13T01:00:00Z",
    },
    {
      // knockout fixture with both teams known → upcoming, even mid-game
      stage: "LAST_16",
      group: null,
      status: "IN_PLAY",
      utcDate: "2026-06-12T19:00:00Z",
      homeTeam: { name: "Brazil" },
      awayTeam: { name: "Spain" },
      score: { winner: null, fullTime: { home: 1, away: 1 } },
    },
    {
      // TBD knockout fixture → skipped entirely
      stage: "LAST_32",
      group: null,
      status: "SCHEDULED",
      utcDate: "2026-06-28T19:00:00Z",
      homeTeam: { name: null },
      awayTeam: { name: null },
      score: { winner: null, fullTime: { home: null, away: null } },
    },
  ];
  const { feed, unmapped } = deriveMatches(matches);
  assert.deepEqual(unmapped, []);
  assert.deepEqual(feed.played, [
    { group: "A", home: "mex", away: "cze", homeGoals: 2, awayGoals: 0 },
  ]);
  // sorted by kickoff: the in-play R16 game (12th) before the group game (13th)
  assert.deepEqual(
    feed.upcoming.map((f) => `${f.home}|${f.away}`),
    ["bra|esp", "kor|rsa"],
  );
  assert.equal(feed.upcoming[0].stage, "LAST_16");
  assert.equal(feed.upcoming[1].group, "A");
});

test("TBD fixtures with null team names don't crash or get counted", () => {
  // Pre-tournament, knockout matches have null teams.
  const tbd: FdMatch = {
    stage: "LAST_32",
    group: null,
    status: "SCHEDULED",
    homeTeam: { name: null },
    awayTeam: { name: null },
    score: { winner: null, fullTime: { home: null, away: null } },
  };
  const { results, unmapped } = deriveResults([tbd]);
  assert.deepEqual(unmapped, []); // nulls aren't "unmapped"
  assert.equal(results.roundTeams.R32, undefined); // no teams recorded
});
