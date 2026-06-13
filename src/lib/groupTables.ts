// ─────────────────────────────────────────────────────────────────────────────
// Live group standings, computed from the games actually played (matches.ts
// `played` feed). Powers the group-stage section of the bracket view: as scores
// land, each group's table reorders so you can watch your predicted 1st/2nd
// hold or slip. Pure — no I/O, fully unit-testable.
//
// Mid-group ordering is an estimate: we sort on points → goal difference →
// goals for → name. FIFA's real tiebreakers add head-to-head and more, but the
// authoritative 1st/2nd land separately in Results.groupResults once a group
// finishes — this table is the "watch it unfold" view, not the official result.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, TEAMS_BY_ID, teamsInGroup, type GroupId } from "./teams";
import type { PlayedGroupMatch } from "./matches";

export interface GroupStanding {
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

function blank(teamId: string): GroupStanding {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

/** Standings for one group, sorted best-first. Every team in the group appears,
 *  even before it has played (so the table is the full group from kickoff). */
export function groupTable(group: GroupId, played: PlayedGroupMatch[]): GroupStanding[] {
  const rows = new Map<string, GroupStanding>(
    teamsInGroup(group).map((t) => [t.id, blank(t.id)]),
  );

  for (const m of played) {
    if (m.group !== group) continue;
    const home = rows.get(m.home);
    const away = rows.get(m.away);
    if (!home || !away) continue; // a team not in our seed data — skip defensively

    home.played++; away.played++;
    home.gf += m.homeGoals; home.ga += m.awayGoals;
    away.gf += m.awayGoals; away.ga += m.homeGoals;

    if (m.homeGoals > m.awayGoals) {
      home.won++; home.points += 3; away.lost++;
    } else if (m.homeGoals < m.awayGoals) {
      away.won++; away.points += 3; home.lost++;
    } else {
      home.drawn++; away.drawn++; home.points++; away.points++;
    }
  }

  for (const r of rows.values()) r.gd = r.gf - r.ga;

  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.gd - a.gd ||
      b.gf - a.gf ||
      (TEAMS_BY_ID[a.teamId]?.name ?? a.teamId).localeCompare(
        TEAMS_BY_ID[b.teamId]?.name ?? b.teamId,
      ),
  );
}

/** All 12 group tables, keyed by group id. */
export function allGroupTables(played: PlayedGroupMatch[]): Record<GroupId, GroupStanding[]> {
  return Object.fromEntries(
    GROUP_IDS.map((g) => [g, groupTable(g, played)]),
  ) as Record<GroupId, GroupStanding[]>;
}
