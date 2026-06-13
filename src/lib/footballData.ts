// ─────────────────────────────────────────────────────────────────────────────
// Turns football-data.org match data into our Results shape. Pure + testable.
//
// ⚠️ VERIFY WHEN LIVE: confirm (a) WC 2026 is in football-data's free tier,
// (b) the team-name spellings below match the live feed (print `unmapped`),
// (c) the stage strings (LAST_32 etc.). Group order here uses pts/GD/GF only —
// FIFA's head-to-head tiebreaker isn't applied, so mid-tournament group order
// is an estimate; it converges to correct once groups finish.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, TEAMS, type GroupId } from "./teams";
import type { KnockoutRound } from "./tournament";
import type { Results } from "./scoring";
import type { MatchFeed } from "./matches";

export interface FdMatch {
  /** football-data match id — stable per fixture, used as a render key. */
  id?: number;
  stage: string;
  group: string | null;
  status: string; // SCHEDULED | IN_PLAY | PAUSED | FINISHED | ...
  /** ISO kickoff time (optional: older test fixtures omit it). */
  utcDate?: string;
  /** Current match minute during IN_PLAY. Absent on some tiers — treat as optional. */
  minute?: number | null;
  // Names are null for not-yet-determined teams (TBD knockout fixtures).
  homeTeam: { name: string | null };
  awayTeam: { name: string | null };
  score: { winner: string | null; fullTime: { home: number | null; away: number | null } };
}

// football-data spellings that differ from ours. Extend after seeing `unmapped`.
const ALIASES: Record<string, string> = {
  "korea republic": "kor",
  "south korea": "kor",
  "ir iran": "irn",
  iran: "irn",
  "united states": "usa",
  "united states of america": "usa",
  usa: "usa",
  "cote d'ivoire": "civ",
  "côte d'ivoire": "civ",
  "ivory coast": "civ",
  "czech republic": "cze",
  czechia: "cze",
  turkey: "tur",
  turkiye: "tur",
  "türkiye": "tur",
  "cabo verde": "cpv",
  "cape verde": "cpv",
  "cape verde islands": "cpv",
  "congo dr": "cod",
  "dr congo": "cod",
  curacao: "cuw",
  "curaçao": "cuw",
  "bosnia and herzegovina": "bih",
  "bosnia-herzegovina": "bih",
  "saudi arabia": "ksa",
  "new zealand": "nzl",
  "south africa": "rsa",
};

const BY_NAME: Record<string, string> = Object.fromEntries(
  TEAMS.map((t) => [t.name.toLowerCase(), t.id]),
);

export function nameToId(name: string | null | undefined): string | null {
  if (!name) return null; // TBD fixtures have null team names
  const n = name.trim().toLowerCase();
  return ALIASES[n] ?? BY_NAME[n] ?? null;
}

// ── Scorers (Golden Boot) ────────────────────────────────────────────────────
// football-data /competitions/WC/scorers — the live goal table. Player ids here
// are the SAME football-data ids the full roster is keyed on (scripts/fetch-
// roster.mjs), so a pick's id matches a scorer's id directly.

export interface FdScorer {
  player: { id?: number; name: string | null };
  team: { name: string | null };
  goals: number | null;
}

export interface ScorerStanding {
  /** football-data player id as a string — matches a roster candidate id. */
  id: string;
  name: string;
  /** internal team id, or null if the team name didn't map. */
  teamId: string | null;
  goals: number;
}

/** Normalize the scorers feed into our standings, goals desc. */
export function deriveScorers(scorers: FdScorer[]): {
  standings: ScorerStanding[];
  unmapped: string[];
} {
  const unmapped = new Set<string>();
  const standings: ScorerStanding[] = [];
  for (const s of scorers) {
    if (s.player?.id == null || !s.player.name) continue;
    const teamId = nameToId(s.team?.name);
    if (s.team?.name && !teamId) unmapped.add(s.team.name);
    standings.push({
      id: String(s.player.id),
      name: s.player.name,
      teamId,
      goals: s.goals ?? 0,
    });
  }
  standings.sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));
  return { standings, unmapped: [...unmapped] };
}

export const STAGE_TO_ROUND: Record<string, KnockoutRound> = {
  LAST_32: "R32",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "FINAL",
};

/** Group → sorted team ids, read from the feed's group-stage fixtures. Used to
 *  verify our DRAFT seed draw against the authoritative schedule. */
export function groupsFromMatches(matches: FdMatch[]): {
  groups: Record<string, string[]>;
  unmapped: string[];
} {
  const unmapped = new Set<string>();
  const sets: Record<string, Set<string>> = {};
  for (const m of matches) {
    if (m.stage !== "GROUP_STAGE" || !m.group) continue;
    const g = m.group.replace("GROUP_", "");
    for (const name of [m.homeTeam.name, m.awayTeam.name]) {
      if (!name) continue;
      const tid = nameToId(name);
      if (!tid) {
        unmapped.add(name);
        continue;
      }
      (sets[g] ??= new Set()).add(tid);
    }
  }
  const groups: Record<string, string[]> = {};
  for (const g of Object.keys(sets)) groups[g] = [...sets[g]].sort();
  return { groups, unmapped: [...unmapped] };
}

/** Statuses that mean "this fixture is still to be decided". */
const UPCOMING_STATUSES = new Set(["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"]);

/** Match-level feed for the box (lib/matches.ts): finished group matches (sim
 *  conditioning) + undecided fixtures with both teams known (rooting views). */
export function deriveMatches(matches: FdMatch[]): { feed: MatchFeed; unmapped: string[] } {
  const unmapped = new Set<string>();
  const id = (name: string | null): string | null => {
    const x = nameToId(name);
    if (name && !x) unmapped.add(name);
    return x;
  };

  const feed: MatchFeed = { played: [], upcoming: [], knockout: [], fetchedAt: new Date().toISOString() };
  for (const m of matches) {
    const h = id(m.homeTeam.name);
    const a = id(m.awayTeam.name);
    if (!h || !a) continue; // TBD fixture — nothing to condition or root on

    // Knockout fixtures (both teams known, any status) feed the bracket tree.
    const koRound = STAGE_TO_ROUND[m.stage];
    if (koRound) {
      feed.knockout!.push({
        // STAGE_TO_ROUND never yields CHAMPION (no stage maps to it).
        round: koRound as Exclude<KnockoutRound, "CHAMPION">,
        home: h,
        away: a,
        winner: m.score.winner === "HOME_TEAM" ? h : m.score.winner === "AWAY_TEAM" ? a : null,
        status: m.status,
      });
    }

    if (m.stage === "GROUP_STAGE" && m.group && m.status === "FINISHED") {
      feed.played.push({
        group: m.group.replace("GROUP_", "") as GroupId,
        home: h,
        away: a,
        homeGoals: m.score.fullTime.home ?? 0,
        awayGoals: m.score.fullTime.away ?? 0,
      });
    } else if (UPCOMING_STATUSES.has(m.status) && m.utcDate) {
      feed.upcoming.push({
        home: h,
        away: a,
        utcDate: m.utcDate,
        stage: m.stage,
        group: m.group ? (m.group.replace("GROUP_", "") as GroupId) : null,
        status: m.status,
      });
    }
  }
  feed.upcoming.sort((x, y) => x.utcDate.localeCompare(y.utcDate));
  return { feed, unmapped: [...unmapped] };
}

export function deriveResults(matches: FdMatch[]): { results: Results; unmapped: string[] } {
  const unmapped = new Set<string>();
  const id = (name: string | null): string | null => {
    const x = nameToId(name);
    if (name && !x) unmapped.add(name); // record real names we couldn't map, not TBD nulls
    return x;
  };

  // ── Group standings (pts, then GD, then GF) ──
  const table: Record<string, { pts: number; gd: number; gf: number }> = {};
  const groupTeams: Record<string, Set<string>> = {};
  const groupMatches: Record<string, { total: number; finished: number }> = {};
  for (const m of matches) {
    if (m.stage !== "GROUP_STAGE" || !m.group) continue;
    const g = m.group.replace("GROUP_", "");
    const h = id(m.homeTeam.name);
    const a = id(m.awayTeam.name);
    if (!h || !a) continue;
    (groupTeams[g] ??= new Set()).add(h);
    groupTeams[g].add(a);
    (groupMatches[g] ??= { total: 0, finished: 0 }).total++;
    table[h] ??= { pts: 0, gd: 0, gf: 0 };
    table[a] ??= { pts: 0, gd: 0, gf: 0 };
    if (m.status !== "FINISHED") continue;
    groupMatches[g].finished++;
    const hg = m.score.fullTime.home ?? 0;
    const ag = m.score.fullTime.away ?? 0;
    table[h].gf += hg;
    table[h].gd += hg - ag;
    table[a].gf += ag;
    table[a].gd += ag - hg;
    if (hg > ag) table[h].pts += 3;
    else if (ag > hg) table[a].pts += 3;
    else {
      table[h].pts += 1;
      table[a].pts += 1;
    }
  }
  const groupResults: Results["groupResults"] = {};
  for (const g of GROUP_IDS) {
    // Only finalize a group once every one of its matches is played — otherwise
    // a 0-0-0 table would emit arbitrary "qualifiers" before any game is decided.
    const mc = groupMatches[g];
    if (!mc || mc.total === 0 || mc.finished < mc.total) continue;
    const teams = [...(groupTeams[g] ?? [])];
    if (teams.length < 2) continue;
    teams.sort(
      (x, y) =>
        table[y].pts - table[x].pts ||
        table[y].gd - table[x].gd ||
        table[y].gf - table[x].gf,
    );
    groupResults[g] = { first: teams[0], second: teams[1] };
  }

  // ── Knockout reaches: a team "reached" a round if it appears in a match there ──
  const roundTeams: Results["roundTeams"] = {};
  for (const m of matches) {
    const round = STAGE_TO_ROUND[m.stage];
    if (!round) continue;
    for (const name of [m.homeTeam.name, m.awayTeam.name]) {
      const tid = id(name);
      if (!tid) continue; // skip TBD teams — don't create an empty round
      const set = (roundTeams[round] ??= []);
      if (!set.includes(tid)) set.push(tid);
    }
  }

  // ── Champion + final goals from the finished FINAL ──
  let finalGoals: number | null = null;
  const final = matches.find((m) => m.stage === "FINAL" && m.status === "FINISHED");
  if (final) {
    finalGoals = (final.score.fullTime.home ?? 0) + (final.score.fullTime.away ?? 0);
    const winnerName =
      final.score.winner === "HOME_TEAM"
        ? final.homeTeam.name
        : final.score.winner === "AWAY_TEAM"
          ? final.awayTeam.name
          : null;
    const champ = winnerName ? id(winnerName) : null;
    if (champ) roundTeams.CHAMPION = [champ];
  }

  return { results: { groupResults, roundTeams, finalGoals }, unmapped: [...unmapped] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Live view — the fast read layer behind the leaderboard's live strip. Unlike
// the cron's MatchFeed (slow, authoritative results/odds), this is fetched by
// the box on a short interval (lib/liveScores.ts) and carries the running score
// so people can watch games — and see whether the team their bracket wants is
// winning. Pure + testable; the box wraps it in caching.
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveGame {
  id: number | null;
  home: string; // team id
  away: string; // team id
  homeGoals: number;
  awayGoals: number;
  /** Current match minute, or null when the feed doesn't expose it. */
  minute: number | null;
  status: "IN_PLAY" | "PAUSED"; // PAUSED = halftime
  stage: string;
  group: GroupId | null;
  utcDate: string | null;
}

export interface FinishedGame {
  id: number | null;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  winner: "home" | "away" | "draw";
  stage: string;
  group: GroupId | null;
  utcDate: string;
}

export interface LiveView {
  /** Games in progress right now (includes halftime). */
  live: LiveGame[];
  /** Finished games from the current ET calendar day — kept on screen so the
   *  day's results stay visible until midnight ET. */
  finishedToday: FinishedGame[];
  /** ISO kickoff of the soonest future fixture — drives the box's poll cadence. */
  nextKickoff: string | null;
  /** A scheduled fixture's kickoff time has already passed but the feed hasn't
   *  flipped it to IN_PLAY yet — the free-tier lag at kickoff. Without this the
   *  poller sees "nothing live, next game hours away" and idles for 30 min,
   *  missing the start of the match. When set, keep polling hot so the strip
   *  picks the game up within seconds of the feed catching up. */
  awaitingKickoff: boolean;
  fetchedAt: string;
}

/** A scheduled kickoff this far in the past, still not IN_PLAY, means the feed
 *  is lagging the real kickoff — treat it as imminent-live for cadence. */
const KICKOFF_GRACE_MS = 30 * 60 * 1000;

/** YYYY-MM-DD in US Eastern — the pool's wall-clock day for "finished today". */
function etDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

const LIVE_STATUSES = new Set(["IN_PLAY", "PAUSED"]);
const SCHEDULED_STATUSES = new Set(["SCHEDULED", "TIMED"]);

export function deriveLive(matches: FdMatch[], now: Date = new Date()): {
  view: LiveView;
  unmapped: string[];
} {
  const unmapped = new Set<string>();
  const id = (name: string | null): string | null => {
    const x = nameToId(name);
    if (name && !x) unmapped.add(name);
    return x;
  };

  const today = etDay(now);
  const nowMs = now.getTime();
  const live: LiveGame[] = [];
  const finishedToday: FinishedGame[] = [];
  let nextKickoff: string | null = null;
  let awaitingKickoff = false;

  for (const m of matches) {
    const h = id(m.homeTeam.name);
    const a = id(m.awayTeam.name);

    if (LIVE_STATUSES.has(m.status) && h && a) {
      live.push({
        id: m.id ?? null,
        home: h,
        away: a,
        homeGoals: m.score.fullTime.home ?? 0,
        awayGoals: m.score.fullTime.away ?? 0,
        minute: m.minute ?? null,
        status: m.status as "IN_PLAY" | "PAUSED",
        stage: m.stage,
        group: m.group ? (m.group.replace("GROUP_", "") as GroupId) : null,
        utcDate: m.utcDate ?? null,
      });
    } else if (m.status === "FINISHED" && h && a && m.utcDate && etDay(new Date(m.utcDate)) === today) {
      const hg = m.score.fullTime.home ?? 0;
      const ag = m.score.fullTime.away ?? 0;
      const winner =
        m.score.winner === "HOME_TEAM" ? "home" : m.score.winner === "AWAY_TEAM" ? "away" : m.score.winner === "DRAW" ? "draw" : hg > ag ? "home" : ag > hg ? "away" : "draw";
      finishedToday.push({
        id: m.id ?? null,
        home: h,
        away: a,
        homeGoals: hg,
        awayGoals: ag,
        winner,
        stage: m.stage,
        group: m.group ? (m.group.replace("GROUP_", "") as GroupId) : null,
        utcDate: m.utcDate,
      });
    } else if (SCHEDULED_STATUSES.has(m.status) && m.utcDate) {
      const koMs = Date.parse(m.utcDate);
      if (koMs > nowMs) {
        if (!nextKickoff || m.utcDate < nextKickoff) nextKickoff = m.utcDate;
      } else if (nowMs - koMs <= KICKOFF_GRACE_MS && h && a) {
        // Kickoff passed, not IN_PLAY yet, teams known — the feed is lagging.
        awaitingKickoff = true;
      }
    }
  }

  live.sort((x, y) => (x.utcDate ?? "").localeCompare(y.utcDate ?? ""));
  finishedToday.sort((x, y) => x.utcDate.localeCompare(y.utcDate));

  return {
    view: { live, finishedToday, nextKickoff, awaitingKickoff, fetchedAt: now.toISOString() },
    unmapped: [...unmapped],
  };
}
