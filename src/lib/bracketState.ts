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
