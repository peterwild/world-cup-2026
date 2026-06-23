// ─────────────────────────────────────────────────────────────────────────────
// Per-pick correctness for the read-only bracket overlay. Mirrors scoreBracket
// (scoring.ts) exactly so the colors never disagree with the points. Pure — no
// I/O, fully unit-testable.
//
// A pick is only "missed" once the relevant result is actually known; until
// then it's "pending" (the team may still get there). "correct" = it happened.
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";
import { ROUND_SIZE, type KnockoutRound } from "./tournament";
import type { Results } from "./scoring";

export type PickStatus = "correct" | "missed" | "pending";

/** Did a team you picked to REACH a knockout round actually reach it?
 *  Pending until that round's field is known. */
export function knockoutPickStatus(
  results: Results,
  round: KnockoutRound,
  teamId: string,
): PickStatus {
  const actual = results.roundTeams[round] ?? [];
  if (actual.includes(teamId)) return "correct"; // confirmed in the field
  // Not (yet) in it. Only a MISS once the round's field is fully known — while it
  // fills in (knockouts play out over days, and football-data pre-fills the
  // bracket with projections), a team not yet listed is still pending, not out.
  // Pre-fix a partial/projected field marked not-yet-listed teams "missed",
  // striking a team like Norway through before its group had even finished.
  return actual.length >= ROUND_SIZE[round] ? "missed" : "pending";
}

/** Did a team you ranked top-2 actually advance from its group?
 *  Pending until the group's 1st/2nd are settled. */
export function groupAdvanceStatus(
  results: Results,
  group: GroupId,
  teamId: string,
): PickStatus {
  const actual = results.groupResults[group];
  if (!actual) return "pending";
  return actual.first === teamId || actual.second === teamId ? "correct" : "missed";
}

/** True only once the group is settled AND this team is the actual winner —
 *  for the +1 winner-bonus tick on the rank-0 pick. */
export function groupWinnerHit(
  results: Results,
  group: GroupId,
  teamId: string,
): boolean {
  return results.groupResults[group]?.first === teamId;
}

/** Wildcard (3rd-place) picks score via the actual R32 field, not group results. */
export function r32PickStatus(results: Results, teamId: string): PickStatus {
  return knockoutPickStatus(results, "R32", teamId);
}

/** Any results in yet? Drives whether the overlay renders at all. */
export function hasAnyResults(results: Results): boolean {
  return (
    Object.keys(results.groupResults).length > 0 ||
    Object.keys(results.roundTeams).length > 0
  );
}
