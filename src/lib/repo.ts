// ─────────────────────────────────────────────────────────────────────────────
// Data access for players + brackets. Server-only (imports node:sqlite via db).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { db, kvGet, kvSet, KV } from "./db";
import { emptyDraft, type DraftBracket } from "./bracketState";
import { emptyResults, type Results } from "./scoring";

export interface Player {
  id: string;
  name: string;
  venmo: string | null;
  paid: boolean;
  is_admin: boolean;
}

interface PlayerRow {
  id: string;
  name: string;
  venmo: string | null;
  paid: number;
  is_admin: number;
}

function toPlayer(r: PlayerRow): Player {
  return { id: r.id, name: r.name, venmo: r.venmo, paid: !!r.paid, is_admin: !!r.is_admin };
}

export function getPlayer(id: string): Player | null {
  const r = db().prepare("SELECT * FROM player WHERE id = ?").get(id) as
    | PlayerRow
    | undefined;
  return r ? toPlayer(r) : null;
}

/** Log in by name: reuse an existing player with the same (case-insensitive)
 *  name so people can resume on another device; otherwise create one. */
export function upsertPlayerByName(name: string): Player {
  const trimmed = name.trim();
  const existing = db()
    .prepare("SELECT * FROM player WHERE name = ? COLLATE NOCASE")
    .get(trimmed) as PlayerRow | undefined;
  if (existing) return toPlayer(existing);

  const id = randomUUID();
  db().prepare("INSERT INTO player(id, name) VALUES(?, ?)").run(id, trimmed);
  db().prepare("INSERT INTO bracket(player_id) VALUES(?)").run(id);
  return { id, name: trimmed, venmo: null, paid: false, is_admin: false };
}

export function checkPasscode(input: string): boolean {
  const real = kvGet<string>(KV.groupPasscode, "");
  return input.trim().toLowerCase() === real.toLowerCase();
}

// ── Bracket ──────────────────────────────────────────────────────────────────

interface BracketRow {
  group_picks: string;
  round_teams: string;
  spirit_team_id: string | null;
  final_goals_tiebreaker: number | null;
  submitted_at: string | null;
}

export function getDraft(playerId: string): { draft: DraftBracket; submittedAt: string | null } {
  const r = db()
    .prepare(
      "SELECT group_picks, round_teams, spirit_team_id, final_goals_tiebreaker, submitted_at FROM bracket WHERE player_id = ?",
    )
    .get(playerId) as BracketRow | undefined;
  if (!r) return { draft: emptyDraft(), submittedAt: null };

  const gp = safeParse<{ groupOrder?: DraftBracket["groupOrder"]; bestThirds?: string[] }>(
    r.group_picks,
    {},
  );
  const base = emptyDraft();
  const draft: DraftBracket = {
    // Merge over the full 12-key base so every group key always exists, even if
    // only some groups were saved.
    groupOrder: { ...base.groupOrder, ...(gp.groupOrder ?? {}) },
    bestThirds: gp.bestThirds ?? [],
    rounds: safeParse(r.round_teams, {}),
    spiritTeamId: r.spirit_team_id,
    finalGoals: r.final_goals_tiebreaker,
  };
  return { draft, submittedAt: r.submitted_at };
}

export function saveDraft(playerId: string, draft: DraftBracket, submit: boolean): void {
  const groupPicks = JSON.stringify({
    groupOrder: draft.groupOrder,
    bestThirds: draft.bestThirds,
  });
  const roundTeams = JSON.stringify(draft.rounds);
  db()
    .prepare(
      `UPDATE bracket
         SET group_picks = ?, round_teams = ?, spirit_team_id = ?,
             final_goals_tiebreaker = ?, updated_at = datetime('now')
             ${submit ? ", submitted_at = COALESCE(submitted_at, datetime('now'))" : ""}
       WHERE player_id = ?`,
    )
    .run(groupPicks, roundTeams, draft.spiritTeamId, draft.finalGoals, playerId);
}

/** Every player paired with their saved bracket — for the leaderboard. */
export function getAllEntries(): { player: Player; draft: DraftBracket; submittedAt: string | null }[] {
  const players = db()
    .prepare("SELECT * FROM player ORDER BY name COLLATE NOCASE")
    .all() as unknown as PlayerRow[];
  return players.map((p) => {
    const { draft, submittedAt } = getDraft(p.id);
    return { player: toPlayer(p), draft, submittedAt };
  });
}

export function getResults(): Results {
  return kvGet<Results>(KV.results, emptyResults());
}

export function setResults(r: Results): void {
  kvSet(KV.results, r);
}

export function getBuyInCents(): number {
  return kvGet<number>(KV.buyInCents, 2000);
}

export function getGroupName(): string {
  return kvGet<string>(KV.groupName, "Kitchen Table");
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
