// ─────────────────────────────────────────────────────────────────────────────
// Client-side working draft of a bracket + derivation/validation helpers.
// The wizard edits a DraftBracket; on submit we serialize to the server shape.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, type GroupId } from "./teams";
import { KNOCKOUT_ROUNDS, ROUND_SIZE, type KnockoutRound } from "./tournament";

export interface DraftBracket {
  /** Per group: team ids in predicted finishing order. We collect the top 3
   *  (1st, 2nd, 3rd); 4th is implied. */
  groupOrder: Record<GroupId, string[]>;
  /** 8 of the 12 third-placed teams, chosen to fill out the Round of 32. */
  bestThirds: string[];
  /** Survivors a player picks into each knockout round AFTER R32.
   *  R32 itself is derived (group top-2 + bestThirds). */
  rounds: Partial<Record<KnockoutRound, string[]>>;
  spiritTeamId: string | null;
  finalGoals: number | null;
}

export function emptyDraft(): DraftBracket {
  const groupOrder = Object.fromEntries(
    GROUP_IDS.map((g) => [g, [] as string[]]),
  ) as unknown as Record<GroupId, string[]>;
  return { groupOrder, bestThirds: [], rounds: {}, spiritTeamId: null, finalGoals: null };
}

// ── Derivations ──────────────────────────────────────────────────────────────

/** The two teams a player has each group finishing 1st/2nd (auto-qualify). */
export function groupAdvancers(d: DraftBracket): string[] {
  return GROUP_IDS.flatMap((g) => (d.groupOrder[g] ?? []).slice(0, 2));
}

/** Each group's predicted winner (slot 0). */
export function groupWinners(d: DraftBracket): string[] {
  return GROUP_IDS.map((g) => (d.groupOrder[g] ?? [])[0]).filter(Boolean);
}

/** The 12 predicted third-place teams (slot 2) — the pool for "best thirds". */
export function thirdPlaceTeams(d: DraftBracket): string[] {
  return GROUP_IDS.map((g) => (d.groupOrder[g] ?? [])[2]).filter(Boolean);
}

/** The Round of 32 field: 24 group qualifiers + the 8 chosen thirds. */
export function r32Field(d: DraftBracket): string[] {
  return [...groupAdvancers(d), ...d.bestThirds];
}

/** How deeply a player's bracket "backs" each team — the live strip uses it to
 *  say whose team is winning. Knockout depth dominates (R32=1 … CHAMPION=6),
 *  with a small group-finish fraction so a group-stage match between two of
 *  your advancers resolves to the one you ranked higher. A team you didn't pick
 *  to reach the knockouts scores < 1; absent teams are 0. Pure + always
 *  available (no time window), so finished games keep their verdict all day. */
const KO_BACKING: { round: KnockoutRound; depth: number }[] = [
  { round: "R16", depth: 2 },
  { round: "QF", depth: 3 },
  { round: "SF", depth: 4 },
  { round: "FINAL", depth: 5 },
  { round: "CHAMPION", depth: 6 },
];
export type BackDepth = Record<string, number>;

export function backingDepth(d: DraftBracket): BackDepth {
  const ko: Record<string, number> = {};
  const bump = (t: string | undefined, v: number) => {
    if (t) ko[t] = Math.max(ko[t] ?? 0, v);
  };
  for (const t of r32Field(d)) bump(t, 1);
  for (const { round, depth } of KO_BACKING) for (const t of d.rounds[round] ?? []) bump(t, depth);

  const frac: Record<string, number> = {};
  for (const g of GROUP_IDS) {
    (d.groupOrder[g] ?? []).forEach((t, i) => {
      if (t) frac[t] = Math.max(frac[t] ?? 0, 0.3 - i * 0.1); // 1st .3 / 2nd .2 / 3rd .1
    });
  }

  const depth: BackDepth = {};
  for (const t of new Set([...Object.keys(ko), ...Object.keys(frac)])) {
    depth[t] = (ko[t] ?? 0) + (frac[t] ?? 0);
  }
  return depth;
}

/** Which team in a head-to-head YOUR bracket carries further, or null if neither
 *  is on your card (or you backed them equally). The whole basis of "who to root
 *  for": the recommendation is read straight off your bracket, never from pool
 *  math, so it can never tell you to root against your own pick. Knockout depth
 *  dominates; the group fraction breaks group-stage games (root for whoever you
 *  ranked to advance). */
export function backedSide(home: string, away: string, back: BackDepth): "home" | "away" | null {
  const dh = back[home] ?? 0;
  const da = back[away] ?? 0;
  if (Math.max(dh, da) <= 0) return null; // neither is anywhere on your bracket
  if (Math.abs(dh - da) < 0.05) return null; // backed equally — no lean
  return dh > da ? "home" : "away";
}

/** Plain-English "why root for them" — how deep YOUR bracket carries the team,
 *  matching backingDepth's scale (CHAMPION=6 … R16=2, R32 field=1, group <1).
 *  `poss` already carries the apostrophe form ("your" / "Dejan's"). */
export function backDepthPhrase(depth: number, poss = "your"): string {
  if (depth >= 6) return `${poss} champion pick`;
  if (depth >= 5) return `${poss} finalist`;
  if (depth >= 4) return `${poss} semifinalist`;
  if (depth >= 3) return `${poss} quarterfinalist`;
  if (depth >= 2) return `in ${poss} round of 16`;
  if (depth >= 1) return `${poss} pick to reach the knockouts`;
  if (depth >= 0.3) return `${poss} pick to win the group`;
  if (depth >= 0.2) return `${poss} pick to advance`;
  return `${poss} group pick`;
}

/** Teams available to pick INTO a given knockout round (the prior round's set). */
export function poolForRound(d: DraftBracket, round: KnockoutRound): string[] {
  if (round === "R32") return [];
  const idx = KNOCKOUT_ROUNDS.indexOf(round);
  const prev = KNOCKOUT_ROUNDS[idx - 1];
  return prev === "R32" ? r32Field(d) : d.rounds[prev] ?? [];
}

// ── Per-step validity (gates the Next button) ────────────────────────────────

export function groupsComplete(d: DraftBracket): boolean {
  // top 3 ranked in every group
  return GROUP_IDS.every((g) => (d.groupOrder[g] ?? []).length >= 3);
}

export function thirdsComplete(d: DraftBracket): boolean {
  return d.bestThirds.length === 8;
}

export function roundComplete(d: DraftBracket, round: KnockoutRound): boolean {
  if (round === "R32") return r32Field(d).length === 32;
  return (d.rounds[round]?.length ?? 0) === ROUND_SIZE[round];
}

export function knockoutComplete(d: DraftBracket): boolean {
  return (["R16", "QF", "SF", "FINAL", "CHAMPION"] as KnockoutRound[]).every((r) =>
    roundComplete(d, r),
  );
}

export function bracketComplete(d: DraftBracket): boolean {
  return (
    groupsComplete(d) &&
    thirdsComplete(d) &&
    knockoutComplete(d) &&
    !!d.spiritTeamId &&
    d.finalGoals !== null
  );
}

/** When a player changes an earlier pick, downstream rounds may now contain
 *  teams that are no longer eligible. Trim each round to its valid pool. */
export function cascadeTrim(d: DraftBracket): DraftBracket {
  const bestThirds = d.bestThirds.filter((id) => thirdPlaceTeams(d).includes(id));
  const next: DraftBracket = { ...d, bestThirds, rounds: { ...d.rounds } };
  for (const round of ["R16", "QF", "SF", "FINAL", "CHAMPION"] as KnockoutRound[]) {
    const pool = poolForRound(next, round);
    next.rounds[round] = (next.rounds[round] ?? []).filter((id) => pool.includes(id));
  }
  if (next.spiritTeamId && !r32Field(next).includes(next.spiritTeamId)) {
    // spirit team can be anyone — leave it; not constrained by bracket
  }
  return next;
}

// ── Persistence (local autosave; server save comes later) ────────────────────

const LS_KEY = "wc26-draft";

export function loadDraft(): DraftBracket {
  if (typeof window === "undefined") return emptyDraft();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyDraft();
    return { ...emptyDraft(), ...(JSON.parse(raw) as DraftBracket) };
  } catch {
    return emptyDraft();
  }
}

export function saveDraft(d: DraftBracket): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(d));
  } catch {
    /* quota / private mode — ignore for prototype */
  }
}
