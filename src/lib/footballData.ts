// ─────────────────────────────────────────────────────────────────────────────
// Turns football-data.org match data into our Results shape. Pure + testable.
//
// ⚠️ VERIFY WHEN LIVE: confirm (a) WC 2026 is in football-data's free tier,
// (b) the team-name spellings below match the live feed (print `unmapped`),
// (c) the stage strings (LAST_32 etc.). Group order here uses pts/GD/GF only —
// FIFA's head-to-head tiebreaker isn't applied, so mid-tournament group order
// is an estimate; it converges to correct once groups finish.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, TEAMS } from "./teams";
import type { KnockoutRound } from "./tournament";
import type { Results } from "./scoring";

export interface FdMatch {
  stage: string;
  group: string | null;
  status: string; // SCHEDULED | IN_PLAY | PAUSED | FINISHED | ...
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

const STAGE_TO_ROUND: Record<string, KnockoutRound> = {
  LAST_32: "R32",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "FINAL",
};

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
  for (const m of matches) {
    if (m.stage !== "GROUP_STAGE" || !m.group) continue;
    const g = m.group.replace("GROUP_", "");
    const h = id(m.homeTeam.name);
    const a = id(m.awayTeam.name);
    if (!h || !a) continue;
    (groupTeams[g] ??= new Set()).add(h);
    groupTeams[g].add(a);
    table[h] ??= { pts: 0, gd: 0, gf: 0 };
    table[a] ??= { pts: 0, gd: 0, gf: 0 };
    if (m.status !== "FINISHED") continue;
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
