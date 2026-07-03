// ─────────────────────────────────────────────────────────────────────────────
// Assembles the live knockout tree: drops the real knockout fixtures (from the
// feed) into the fixed bracket skeleton, then overlays which teams the player
// backed to reach each round. Pure — no I/O, fully unit-testable.
//
// Mapping fixtures → skeleton slots:
//   • R32 — identify a slot by its group-position definition. The winner/runner-
//     up sides are exact; a third-place side just needs the actual team's group
//     to be in its candidate set. So we never need FIFA's 495-combination table:
//     the feed supplies the third-placer, the skeleton supplies the slot.
//   • R16 and up — a match's two teams are the winners of two child matches we've
//     already placed, so we link by winner identity, no group lookup needed.
// ─────────────────────────────────────────────────────────────────────────────

import { TEAMS_BY_ID } from "./teams";
import { r32Field, type DraftBracket } from "./bracketState";
import type { Results } from "./scoring";
import type { KoFixture } from "./matches";
import type { KnockoutRound } from "./tournament";
import {
  KO_TEMPLATE,
  FINAL_MATCH,
  childMatches,
  type SlotSource,
  type TemplateMatch,
} from "./knockoutTemplate";

type KoRound = Exclude<KnockoutRound, "CHAMPION">;

/** One side of a bracket match as rendered. */
export interface BracketSlot {
  teamId: string | null; // null = not yet known (TBD)
  /** The player picked this team to reach this round (→ it scores for them). */
  picked: boolean;
  /** This team won the match and advanced. */
  advanced: boolean;
}

export interface BracketNode {
  match: number;
  round: KoRound;
  home: BracketSlot;
  away: BracketSlot;
}

export interface AssembledBracket {
  nodes: Record<number, BracketNode>;
  champion: { teamId: string | null; picked: boolean };
  /** True once any knockout fixture is known — gates the "begins June…" empty state. */
  hasFixtures: boolean;
}

/** A team's group finish, from the settled group results. */
function placeOf(teamId: string, results: Results): "winner" | "runnerup" | "third" | null {
  const team = TEAMS_BY_ID[teamId];
  if (!team) return null;
  const gr = results.groupResults[team.group];
  if (!gr) return null;
  if (gr.first === teamId) return "winner";
  if (gr.second === teamId) return "runnerup";
  return "third"; // in the R32 field but not top-2 of its group
}

/** Does a team satisfy an R32 slot's group-position definition? */
function fitsSlot(source: SlotSource, teamId: string, results: Results): boolean {
  const team = TEAMS_BY_ID[teamId];
  if (!team) return false;
  const place = placeOf(teamId, results);
  switch (source.kind) {
    case "winner":
      return source.group === team.group && place === "winner";
    case "runnerup":
      return source.group === team.group && place === "runnerup";
    case "third":
      return place === "third" && source.groups.includes(team.group);
    case "matchWinner":
      return false; // not an R32 slot
  }
}

/** The team ids a player backed to REACH a given round (R32 = group top-2 + their
 *  8 chosen thirds; later rounds = the explicit set). */
function pickedForRound(draft: DraftBracket, round: KoRound): Set<string> {
  return new Set(round === "R32" ? r32Field(draft) : draft.rounds[round] ?? []);
}

export function assembleBracket(
  fixtures: KoFixture[],
  results: Results,
  draft: DraftBracket,
): AssembledBracket {
  const nodes: Record<number, BracketNode> = {};
  const pickedByRound: Record<KoRound, Set<string>> = {
    R32: pickedForRound(draft, "R32"),
    R16: pickedForRound(draft, "R16"),
    QF: pickedForRound(draft, "QF"),
    SF: pickedForRound(draft, "SF"),
    FINAL: pickedForRound(draft, "FINAL"),
  };

  const slot = (teamId: string | null, round: KoRound, winnerId: string | null): BracketSlot => ({
    teamId,
    picked: !!teamId && pickedByRound[round].has(teamId),
    advanced: !!teamId && teamId === winnerId,
  });

  // Start every template match as an empty (TBD) node.
  for (const tm of KO_TEMPLATE) {
    nodes[tm.match] = {
      match: tm.match,
      round: tm.round,
      home: slot(null, tm.round, null),
      away: slot(null, tm.round, null),
    };
  }

  const place = (
    tm: TemplateMatch,
    homeId: string | null,
    awayId: string | null,
    winnerId: string | null,
  ) => {
    nodes[tm.match].home = slot(homeId, tm.round, winnerId);
    nodes[tm.match].away = slot(awayId, tm.round, winnerId);
  };

  // ── R32: match each fixture to the slot whose two group-position defs it fits ──
  for (const fx of fixtures) {
    if (fx.round !== "R32") continue;
    for (const tm of KO_TEMPLATE) {
      if (tm.round !== "R32") continue;
      if (fitsSlot(tm.a, fx.home, results) && fitsSlot(tm.b, fx.away, results)) {
        place(tm, fx.home, fx.away, fx.winner);
        break;
      }
      if (fitsSlot(tm.a, fx.away, results) && fitsSlot(tm.b, fx.home, results)) {
        place(tm, fx.away, fx.home, fx.winner); // keep slot-a team in home
        break;
      }
    }
  }

  // ── R16 → FINAL: a match's two teams ARE the winners of its child matches. We
  // place a side as soon as its child is decided — even if the sibling child isn't
  // yet (a team that won its match has advanced; its opponent can stay TBD). We
  // never wait for the feed to resolve the fixture's team names (which lags behind
  // the child finishes). The feed fixture is consulted only for the winner, once
  // both teams are set and the match is played.
  const winnerOf = (match: number): string | null => {
    const n = nodes[match];
    if (n.home.advanced) return n.home.teamId;
    if (n.away.advanced) return n.away.teamId;
    return null;
  };
  for (const round of ["R16", "QF", "SF", "FINAL"] as const) {
    for (const tm of KO_TEMPLATE) {
      if (tm.round !== round) continue;
      const [c1, c2] = childMatches(tm.match);
      const w1 = winnerOf(c1);
      const w2 = winnerOf(c2);
      if (!w1 && !w2) continue; // neither side decided yet
      // Only once both teams are known can the feed have a fixture (→ its winner).
      const fx =
        w1 && w2
          ? fixtures.find(
              (f) =>
                f.round === round &&
                ((f.home === w1 && f.away === w2) || (f.home === w2 && f.away === w1)),
            )
          : undefined;
      // home keeps the team that came up child-a (c1); an undecided side is TBD.
      place(tm, w1, w2, fx?.winner ?? null);
    }
  }

  const championId = winnerOf(FINAL_MATCH);
  const fixturesKnown = fixtures.some((f) => f.home && f.away);
  return {
    nodes,
    champion: {
      teamId: championId,
      picked: !!championId && (draft.rounds.CHAMPION ?? []).includes(championId),
    },
    hasFixtures: fixturesKnown,
  };
}
