// ─────────────────────────────────────────────────────────────────────────────
// Match-level feed pushed by the score poller (scripts/poll-scores.mjs).
// Results (results kv) only carries DERIVED state — group qualifiers, round
// reaches — which is all the scorer needs. Two features need finer grain:
//   • played group matches → the sim conditions mid-group (a team that started
//     2-0-0 should be likelier to advance than its blank-slate Elo says)
//   • upcoming fixtures   → "who to root for" (lib/analytics.ts rooting)
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";
import { kvGet, kvSet } from "./db";

/** A finished group-stage match, in real home/away orientation. */
export interface PlayedGroupMatch {
  group: GroupId;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
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
  fetchedAt: string; // ISO
}

const MATCHES_KEY = "matches";

export function getMatchFeed(): MatchFeed | null {
  return kvGet<MatchFeed | null>(MATCHES_KEY, null);
}

export function setMatchFeed(feed: MatchFeed): void {
  kvSet(MATCHES_KEY, feed);
}
