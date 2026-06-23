import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveLive,
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

test("scheduled/projected knockout fixtures don't count as reaches", () => {
  // football-data pre-fills the LAST_32 bracket with projected qualifiers before
  // the group stage ends. A scheduled (un-played) one must NOT credit a reach —
  // otherwise teams bank knockout points mid-group and flicker as projections move.
  const projected: FdMatch = {
    stage: "LAST_32",
    group: null,
    status: "SCHEDULED",
    homeTeam: { name: "Germany" },
    awayTeam: { name: "Mexico" },
    score: { winner: null, fullTime: { home: null, away: null } },
  };
  const { results } = deriveResults([projected]);
  assert.equal(results.roundTeams.R32, undefined);
});

test("a live knockout match does count as a reach", () => {
  const live: FdMatch = {
    stage: "LAST_32",
    group: null,
    status: "IN_PLAY",
    homeTeam: { name: "Germany" },
    awayTeam: { name: "Mexico" },
    score: { winner: null, fullTime: { home: 0, away: 0 } },
  };
  const { results } = deriveResults([live]);
  assert.deepEqual(results.roundTeams.R32?.sort(), ["ger", "mex"]);
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

test("deriveLive: in-play games with running score + minute", () => {
  const now = new Date("2026-06-12T18:00:00Z"); // 14:00 ET, June 12
  const matches: FdMatch[] = [
    {
      stage: "GROUP_STAGE",
      group: "GROUP_A",
      status: "IN_PLAY",
      utcDate: "2026-06-12T17:00:00Z",
      minute: 63,
      id: 101,
      homeTeam: { name: "Mexico" },
      awayTeam: { name: "Czechia" },
      score: { winner: null, fullTime: { home: 2, away: 1 } },
    },
    {
      stage: "GROUP_STAGE",
      group: "GROUP_B",
      status: "PAUSED", // halftime
      utcDate: "2026-06-12T17:30:00Z",
      id: 102,
      homeTeam: { name: "Brazil" },
      awayTeam: { name: "Spain" },
      score: { winner: null, fullTime: { home: 0, away: 0 } },
    },
  ];
  const { view } = deriveLive(matches, now);
  assert.equal(view.live.length, 2);
  assert.deepEqual(
    { ...view.live[0] },
    {
      id: 101,
      home: "mex",
      away: "cze",
      homeGoals: 2,
      awayGoals: 1,
      minute: 63,
      status: "IN_PLAY",
      stage: "GROUP_STAGE",
      group: "A",
      utcDate: "2026-06-12T17:00:00Z",
    },
  );
  assert.equal(view.live[1].status, "PAUSED");
  assert.equal(view.live[1].minute, null); // no minute on the feed → null, not 0
});

test("deriveLive: finishedToday respects the ET calendar day", () => {
  const now = new Date("2026-06-12T18:00:00Z"); // June 12 ET
  const fin = (home: string, away: string, h: number, a: number, utcDate: string): FdMatch => ({
    stage: "GROUP_STAGE",
    group: "GROUP_A",
    status: "FINISHED",
    utcDate,
    homeTeam: { name: home },
    awayTeam: { name: away },
    score: { winner: h > a ? "HOME_TEAM" : a > h ? "AWAY_TEAM" : "DRAW", fullTime: { home: h, away: a } },
  });
  const matches: FdMatch[] = [
    fin("Mexico", "Czechia", 3, 1, "2026-06-12T16:00:00Z"), // 12:00 ET June 12 → today
    fin("Brazil", "Spain", 0, 0, "2026-06-12T01:00:00Z"), // 21:00 ET June 11 → yesterday, excluded
  ];
  const { view } = deriveLive(matches, now);
  assert.equal(view.live.length, 0);
  assert.equal(view.finishedToday.length, 1);
  assert.deepEqual(
    { home: view.finishedToday[0].home, away: view.finishedToday[0].away, winner: view.finishedToday[0].winner },
    { home: "mex", away: "cze", winner: "home" },
  );
});

test("deriveLive: nextKickoff is the soonest future fixture; TBD live games skipped", () => {
  const now = new Date("2026-06-12T18:00:00Z");
  const matches: FdMatch[] = [
    {
      stage: "GROUP_STAGE",
      group: "GROUP_C",
      status: "TIMED",
      utcDate: "2026-06-13T01:00:00Z",
      homeTeam: { name: "South Korea" },
      awayTeam: { name: "South Africa" },
      score: { winner: null, fullTime: { home: null, away: null } },
    },
    {
      stage: "GROUP_STAGE",
      group: "GROUP_D",
      status: "SCHEDULED",
      utcDate: "2026-06-12T22:00:00Z", // sooner
      homeTeam: { name: "France" },
      awayTeam: { name: "Haiti" },
      score: { winner: null, fullTime: { home: null, away: null } },
    },
    {
      // TBD knockout in progress (shouldn't happen, but null teams must not crash)
      stage: "LAST_16",
      group: null,
      status: "IN_PLAY",
      utcDate: "2026-06-12T17:00:00Z",
      homeTeam: { name: null },
      awayTeam: { name: null },
      score: { winner: null, fullTime: { home: 1, away: 0 } },
    },
  ];
  const { view } = deriveLive(matches, now);
  assert.equal(view.live.length, 0); // TBD live game skipped
  assert.equal(view.nextKickoff, "2026-06-12T22:00:00Z");
  assert.equal(view.awaitingKickoff, false);
});

test("deriveLive: kickoff passed but feed still TIMED → render as live (trust the clock)", () => {
  const now = new Date("2026-06-12T19:00:30Z"); // 30s past kickoff
  const matches: FdMatch[] = [
    {
      stage: "GROUP_STAGE",
      group: "GROUP_B",
      status: "TIMED", // feed hasn't flipped to IN_PLAY yet
      utcDate: "2026-06-12T19:00:00Z",
      homeTeam: { name: "Canada" },
      awayTeam: { name: "Bosnia-Herzegovina" },
      score: { winner: null, fullTime: { home: null, away: null } },
    },
    {
      stage: "GROUP_STAGE",
      group: "GROUP_C",
      status: "TIMED",
      utcDate: "2026-06-13T01:00:00Z", // next real fixture, hours away
      homeTeam: { name: "South Korea" },
      awayTeam: { name: "South Africa" },
      score: { winner: null, fullTime: { home: null, away: null } },
    },
  ];
  const { view } = deriveLive(matches, now);
  assert.equal(view.live.length, 1); // kickoff passed + not finished → live
  assert.equal(view.live[0].home, "can");
  assert.equal(view.live[0].status, "IN_PLAY");
  assert.equal(view.awaitingKickoff, true); // unconfirmed by feed → keep polling hot
  assert.equal(view.nextKickoff, "2026-06-13T01:00:00Z"); // still future-only
});

test("deriveLive: feed slow to leave TIMED well past kickoff → still rendered live", () => {
  // Tonight's bug: the free tier held USA–Paraguay at TIMED for ~50–90 min past
  // kickoff before advancing to IN_PLAY. The clock says it's in progress, so we
  // keep it on the strip rather than letting it vanish into the kickoff cliff.
  const now = new Date("2026-06-13T01:40:00Z"); // 40 min past kickoff, feed still TIMED
  const matches: FdMatch[] = [
    {
      id: 999,
      stage: "GROUP_STAGE",
      group: "GROUP_D",
      status: "TIMED", // free tier hasn't advanced to IN_PLAY yet
      utcDate: "2026-06-13T01:00:00Z",
      minute: null,
      homeTeam: { name: "United States" },
      awayTeam: { name: "Paraguay" },
      score: { winner: null, fullTime: { home: 1, away: 0 } },
    },
  ];
  const { view } = deriveLive(matches, now);
  assert.equal(view.live.length, 1);
  assert.equal(view.live[0].home, "usa");
  assert.equal(view.live[0].homeGoals, 1); // carries whatever score the feed has
  assert.equal(view.awaitingKickoff, true);
});

test("deriveLive: truly stale TIMED kickoff beyond the match window is dropped", () => {
  const now = new Date("2026-06-12T23:30:00Z"); // 4.5h past kickoff — game long over
  const matches: FdMatch[] = [
    {
      stage: "GROUP_STAGE",
      group: "GROUP_B",
      status: "TIMED",
      utcDate: "2026-06-12T19:00:00Z",
      homeTeam: { name: "Canada" },
      awayTeam: { name: "Bosnia-Herzegovina" },
      score: { winner: null, fullTime: { home: null, away: null } },
    },
  ];
  const { view } = deriveLive(matches, now);
  assert.equal(view.live.length, 0); // beyond window → not a phantom live game
  assert.equal(view.awaitingKickoff, false);
});
