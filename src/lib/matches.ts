// ─────────────────────────────────────────────────────────────────────────────
// Match-level feed pushed by the score poller (scripts/poll-scores.mjs).
// Results (results kv) only carries DERIVED state — group qualifiers, round
// reaches — which is all the scorer needs. Two features need finer grain:
//   • played group matches → the sim conditions mid-group (a team that started
//     2-0-0 should be likelier to advance than its blank-slate Elo says)
//   • upcoming fixtures   → "who to root for" (lib/analytics.ts rooting)
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";
import type { KnockoutRound } from "./tournament";
import { kvGet, kvSet } from "./db";

/** A finished group-stage match, in real home/away orientation. */
export interface PlayedGroupMatch {
  group: GroupId;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

/** A knockout fixture with both teams known (any status). Drives the bracket
 *  tree: home/away are team ids, `winner` is set once decided. */
export interface KoFixture {
  round: Exclude<KnockoutRound, "CHAMPION">;
  home: string;
  away: string;
  winner: string | null; // team id, or null until the match is decided
  status: string; // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED
}

/** A not-yet-finished fixture with both teams known (TBD slots are skipped). */
export interface FeedFixture {
  home: string;
  away: string;
  /** ISO kickoff time. */
  utcDate: string;
  /** football-data stage: GROUP_STAGE | LAST_32 | ... | FINAL */
  stage: string;
  group: GroupId | null;
  /** SCHEDULED | TIMED | IN_PLAY | PAUSED */
  status: string;
}

export interface MatchFeed {
  played: PlayedGroupMatch[];
  upcoming: FeedFixture[];
  /** Knockout fixtures with both teams known — the bracket tree's raw input.
   *  Absent on feeds written before this field existed; read as []. */
  knockout?: KoFixture[];
  fetchedAt: string; // ISO
}

const MATCHES_KEY = "matches";

export function getMatchFeed(): MatchFeed | null {
  return kvGet<MatchFeed | null>(MATCHES_KEY, null);
}

export function setMatchFeed(feed: MatchFeed): void {
  kvSet(MATCHES_KEY, feed);
}
