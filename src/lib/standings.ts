// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard: score every player, rank them, and project payouts.
// Server-only (reads the DB via repo).
// ─────────────────────────────────────────────────────────────────────────────

import {
  getAllEntries,
  getBuyInCents,
  getResults,
  type Player,
} from "./repo";
import {
  championOf,
  scoreBracket,
  tiebreakDistance,
  type Results,
  type ScoreBreakdown,
} from "./scoring";
import { bracketComplete } from "./bracketState";
import { computePayouts } from "./tournament";

export interface Standing {
  rank: number;
  player: Player;
  score: ScoreBreakdown;
  tiebreak: number | null;
  spiritChampion: boolean;
  payoutCents: number;
}

export interface Leaderboard {
  standings: Standing[];
  potCents: number;
  buyInCents: number;
  entrants: number;
  paidCount: number;
  spiritChampions: Player[];
  championId: string | null;
  hasResults: boolean;
}

export function computeLeaderboard(): Leaderboard {
  // You're only "in the pool" once your bracket is complete — creating an
  // account isn't enough. Incomplete entries don't count toward the pot.
  const entries = getAllEntries().filter((e) => bracketComplete(e.draft));
  const results = getResults();
  const buyInCents = getBuyInCents();

  const scored = entries.map((e) => ({
    player: e.player,
    score: scoreBracket(e.draft, results),
    tiebreak: tiebreakDistance(e.draft, results),
  }));

  // Rank by total desc, then closest tiebreaker (nulls last), then name.
  scored.sort((a, b) => {
    if (b.score.total !== a.score.total) return b.score.total - a.score.total;
    const at = a.tiebreak;
    const bt = b.tiebreak;
    if (at !== bt) {
      if (at === null) return 1;
      if (bt === null) return -1;
      return at - bt;
    }
    return a.player.name.localeCompare(b.player.name);
  });

  // Payouts go to the top 3 by finishing position. Exact ties at a paid rank
  // are rare in a friend pool and settled by hand — noted on the page.
  const payouts = computePayouts(entries.length * buyInCents);

  const standings: Standing[] = scored.map((s, i) => ({
    rank: i + 1,
    player: s.player,
    score: s.score,
    tiebreak: s.tiebreak,
    spiritChampion: s.score.spiritChampion,
    payoutCents: payouts[i] ?? 0,
  }));

  return {
    standings,
    potCents: entries.length * buyInCents,
    buyInCents,
    entrants: entries.length,
    paidCount: entries.filter((e) => e.player.paid).length,
    spiritChampions: scored.filter((s) => s.score.spiritChampion).map((s) => s.player),
    championId: championOf(results),
    hasResults:
      Object.keys(results.groupResults).length > 0 ||
      Object.keys(results.roundTeams).length > 0,
  };
}

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
