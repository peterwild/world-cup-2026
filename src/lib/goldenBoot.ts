// ─────────────────────────────────────────────────────────────────────────────
// Golden Boot side bet — pick the player who scores the most goals in the
// tournament. A separate, opt-in pool ($20 buy-in, settled apart from the main
// bracket pot) that opens AFTER the bracket lock and itself locks at the end of
// the group stage (first Round-of-32 kickoff).
//
// Candidate set: the picker reads `getCandidates()`, which prefers the cached
// `golden_boot_roster` KV (the full tournament roster, harvested from
// football-data /teams squads by scripts/fetch-roster.mjs) and falls back to a
// curated shortlist when squads aren't available on the free tier. Either way a
// pick is an id WITHIN that set, and resolution just compares `pickId` to the
// admin-set winning id — so correctness never depends on football-data ids,
// they only make post-tournament auto-resolution match the scorers feed.
//
// Pure + testable: no I/O except the kv reads in the accessor helpers, which the
// resolve/pot math doesn't touch (they take plain arrays).
// ─────────────────────────────────────────────────────────────────────────────

import { kvGet, kvSet, KV } from "./db";
import { type MatchFeed } from "./matches";
import { STAGE_TO_ROUND, type ScorerStanding } from "./footballData";

export interface BootCandidate {
  /** id within the active candidate set (fd player id when from the roster, a
   *  stable slug when from the shortlist). */
  id: string;
  name: string;
  /** internal team id (teams.ts) — drives the flag. */
  teamId: string;
}

/** One player's Golden Boot state — the shape resolve/pot math operate on. */
export interface GoldenBootEntry {
  playerId: string;
  status: "in" | "declined";
  pickId: string | null;
  paid: boolean;
}

// Curated contenders, used only when the full roster isn't loaded. Ids are
// stable slugs; teamId must exist in teams.ts. Extend freely — order here is the
// fallback display order (the picker sorts/groups by team anyway).
export const SHORTLIST_FALLBACK: BootCandidate[] = [
  { id: "gb-mbappe", name: "Kylian Mbappé", teamId: "fra" },
  { id: "gb-kolo-muani", name: "Randal Kolo Muani", teamId: "fra" },
  { id: "gb-dembele", name: "Ousmane Dembélé", teamId: "fra" },
  { id: "gb-messi", name: "Lionel Messi", teamId: "arg" },
  { id: "gb-julian-alvarez", name: "Julián Álvarez", teamId: "arg" },
  { id: "gb-lautaro", name: "Lautaro Martínez", teamId: "arg" },
  { id: "gb-vinicius", name: "Vinícius Júnior", teamId: "bra" },
  { id: "gb-rodrygo", name: "Rodrygo", teamId: "bra" },
  { id: "gb-raphinha", name: "Raphinha", teamId: "bra" },
  { id: "gb-kane", name: "Harry Kane", teamId: "eng" },
  { id: "gb-bellingham", name: "Jude Bellingham", teamId: "eng" },
  { id: "gb-foden", name: "Phil Foden", teamId: "eng" },
  { id: "gb-yamal", name: "Lamine Yamal", teamId: "esp" },
  { id: "gb-olmo", name: "Dani Olmo", teamId: "esp" },
  { id: "gb-morata", name: "Álvaro Morata", teamId: "esp" },
  { id: "gb-ronaldo", name: "Cristiano Ronaldo", teamId: "por" },
  { id: "gb-leao", name: "Rafael Leão", teamId: "por" },
  { id: "gb-bruno", name: "Bruno Fernandes", teamId: "por" },
  { id: "gb-musiala", name: "Jamal Musiala", teamId: "ger" },
  { id: "gb-havertz", name: "Kai Havertz", teamId: "ger" },
  { id: "gb-wirtz", name: "Florian Wirtz", teamId: "ger" },
  { id: "gb-gakpo", name: "Cody Gakpo", teamId: "ned" },
  { id: "gb-depay", name: "Memphis Depay", teamId: "ned" },
  { id: "gb-haaland", name: "Erling Haaland", teamId: "nor" },
  { id: "gb-lukaku", name: "Romelu Lukaku", teamId: "bel" },
  { id: "gb-de-bruyne", name: "Kevin De Bruyne", teamId: "bel" },
  { id: "gb-nunez", name: "Darwin Núñez", teamId: "uru" },
  { id: "gb-luis-diaz", name: "Luis Díaz", teamId: "col" },
  { id: "gb-pulisic", name: "Christian Pulisic", teamId: "usa" },
  { id: "gb-gyokeres", name: "Viktor Gyökeres", teamId: "swe" },
  { id: "gb-salah", name: "Mohamed Salah", teamId: "egy" },
  { id: "gb-osimhen", name: "—", teamId: "mar" }, // placeholder slot; real roster supersedes
  { id: "gb-en-nesyri", name: "Youssef En-Nesyri", teamId: "mar" },
  { id: "gb-jimenez", name: "Raúl Jiménez", teamId: "mex" },
  { id: "gb-mitoma", name: "Kaoru Mitoma", teamId: "jpn" },
  { id: "gb-jovic", name: "Luka Jović", teamId: "sui" },
].filter((c) => c.name !== "—");

/** Active candidate set: cached full roster if present, else the shortlist. */
export function getCandidates(): BootCandidate[] {
  const roster = kvGet<BootCandidate[] | null>(KV.goldenBootRoster, null);
  return roster && roster.length > 0 ? roster : SHORTLIST_FALLBACK;
}

export function getGoldenBootBuyInCents(): number {
  return kvGet<number>(KV.goldenBootBuyInCents, 2000);
}

export function getGoldenBootResult(): string | null {
  return kvGet<string | null>(KV.goldenBootResult, null);
}

/** Earliest Round-of-32 kickoff in the feed = end of group stage. Pure. R32
 *  fixtures only appear once both teams are known (as groups finish), so this is
 *  null until the bracket fills in. */
export function firstR32Kickoff(feed: MatchFeed | null): string | null {
  if (!feed) return null;
  const r32Kickoffs = feed.upcoming
    .filter((f) => STAGE_TO_ROUND[f.stage] === "R32")
    .map((f) => f.utcDate)
    .sort();
  return r32Kickoffs[0] ?? null;
}

/** Golden Boot picks close at the end of June 17 (23:59 ET = 03:59Z on the
 *  18th). Known up front, so we don't wait on the feed to fill in. */
export const GROUP_STAGE_LOCK_ISO = "2026-06-18T03:59:00Z";

/** When Golden Boot picks lock. An explicit KV override wins; otherwise the
 *  group-stage close above. Null reads as "still open". */
export function goldenBootLockAt(): string | null {
  const override = kvGet<string | null>(KV.goldenBootLockAt, null);
  return override ?? GROUP_STAGE_LOCK_ISO;
}

export function goldenBootLocked(now: Date = new Date()): boolean {
  const lockAt = goldenBootLockAt();
  if (!lockAt) return false;
  return now >= new Date(lockAt);
}

/** Players actually in the side pot: opted in AND have committed a pick. */
function participants(entries: GoldenBootEntry[]): GoldenBootEntry[] {
  return entries.filter((e) => e.status === "in" && e.pickId);
}

/** Pledged pot = participants × buy-in (mirrors the main pot, which counts
 *  entrants not paid; `paid` is a collection detail shown separately). */
export function goldenBootPot(entries: GoldenBootEntry[], buyInCents: number): number {
  return participants(entries).length * buyInCents;
}

export interface GoldenBootResolution {
  potCents: number;
  /** player ids who picked the actual top scorer. */
  winnerIds: string[];
  /** true when nobody picked the winner → everyone in is refunded. */
  refund: boolean;
  /** split per winner, or (on refund) each participant's buy-in back. */
  perPlayerCents: number;
}

// ── Live goal table (Golden Boot race) ───────────────────────────────────────

export function getScorers(): ScorerStanding[] {
  return kvGet<ScorerStanding[]>(KV.goldenBootScorers, []);
}

export function setScorers(standings: ScorerStanding[]): void {
  kvSet(KV.goldenBootScorers, standings);
}

/** Goals scored so far by a given pick, or null if that pick hasn't scored
 *  (not in the table — the feed only lists players with ≥1 goal). */
export function goalsForPick(standings: ScorerStanding[], pickId: string | null): number | null {
  if (!pickId) return null;
  const hit = standings.find((s) => s.id === pickId);
  return hit ? hit.goals : null;
}

/** Current leader(s) of the race. `tied` when more than one shares the top
 *  goal count — the real award breaks ties (assists, fewer minutes); the pool
 *  settles those by hand, so we never auto-resolve a tie. */
export function goldenBootLeader(standings: ScorerStanding[]): {
  leaders: ScorerStanding[];
  tied: boolean;
} {
  if (standings.length === 0) return { leaders: [], tied: false };
  const top = standings[0].goals;
  if (top <= 0) return { leaders: [], tied: false };
  const leaders = standings.filter((s) => s.goals === top);
  return { leaders, tied: leaders.length > 1 };
}

export function resolveGoldenBoot(
  entries: GoldenBootEntry[],
  resultId: string,
  buyInCents: number,
): GoldenBootResolution {
  const inPool = participants(entries);
  const potCents = inPool.length * buyInCents;
  const winnerIds = inPool.filter((e) => e.pickId === resultId).map((e) => e.playerId);
  const refund = winnerIds.length === 0;
  const perPlayerCents = refund
    ? buyInCents
    : Math.floor(potCents / winnerIds.length);
  return { potCents, winnerIds, refund, perPlayerCents };
}
