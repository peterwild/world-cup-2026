// ─────────────────────────────────────────────────────────────────────────────
// Data access for players + brackets. Server-only (imports node:sqlite via db).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { db, kvGet, kvSet, KV } from "./db";
import { emptyDraft, bracketComplete, cascadeTrim, type DraftBracket } from "./bracketState";
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
  ai_assisted: number;
}

export function getDraft(playerId: string): {
  draft: DraftBracket;
  submittedAt: string | null;
  aiAssisted: boolean;
} {
  const r = db()
    .prepare(
      "SELECT group_picks, round_teams, spirit_team_id, final_goals_tiebreaker, submitted_at, ai_assisted FROM bracket WHERE player_id = ?",
    )
    .get(playerId) as BracketRow | undefined;
  if (!r) return { draft: emptyDraft(), submittedAt: null, aiAssisted: false };

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
  return { draft, submittedAt: r.submitted_at, aiAssisted: !!r.ai_assisted };
}

/** Sticky flag: set once when a player accepts an AI-built bracket. Never
 *  cleared — survives later manual edits (that's the point of the badge). */
export function markAiAssisted(playerId: string): void {
  db().prepare("UPDATE bracket SET ai_assisted = 1 WHERE player_id = ?").run(playerId);
}

export function saveDraft(playerId: string, draft: DraftBracket, submit: boolean): void {
  // Normalize before persisting: cascadeTrim drops any downstream pick that's no
  // longer valid given earlier picks, so the DB can never hold a self-contradictory
  // bracket regardless of who's writing (wizard, AI, or a direct API call).
  const clean = cascadeTrim(draft);
  const groupPicks = JSON.stringify({
    groupOrder: clean.groupOrder,
    bestThirds: clean.bestThirds,
  });
  const roundTeams = JSON.stringify(clean.rounds);
  // Stamp submitted_at the first time a bracket is complete — on explicit
  // "Lock it in" OR a plain autosave that happens to be complete. COALESCE keeps
  // it sticky, so a later edit that cascades a bracket back to incomplete (and
  // autosaves that) never drops the player out of the pot. [pot-membership]
  const stampSubmitted = submit || bracketComplete(clean);
  db()
    .prepare(
      `UPDATE bracket
         SET group_picks = ?, round_teams = ?, spirit_team_id = ?,
             final_goals_tiebreaker = ?, updated_at = datetime('now')
             ${stampSubmitted ? ", submitted_at = COALESCE(submitted_at, datetime('now'))" : ""}
       WHERE player_id = ?`,
    )
    .run(groupPicks, roundTeams, clean.spiritTeamId, clean.finalGoals, playerId);
}

/** Every player paired with their saved bracket — for the leaderboard. */
export function getAllEntries(): {
  player: Player;
  draft: DraftBracket;
  submittedAt: string | null;
  aiAssisted: boolean;
}[] {
  const players = db()
    .prepare("SELECT * FROM player ORDER BY name COLLATE NOCASE")
    .all() as unknown as PlayerRow[];
  return players.map((p) => {
    const { draft, submittedAt, aiAssisted } = getDraft(p.id);
    return { player: toPlayer(p), draft, submittedAt, aiAssisted };
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

// ── AI Mode session ────────────────────────────────────────────────────────────
// Budget is server-authoritative (keyed to player id) so a reload or new device
// can't reset it. spend_cents counts UP toward the buy-in (the AI budget).

export interface AiSession {
  /** chosen model key (opus|sonnet|haiku), null until the player picks one */
  model: string | null;
  spendCents: number;
  /** persisted Converse message history, for resuming mid-conversation */
  transcript: unknown[];
  /** last propose_bracket payload the model emitted, or null */
  proposal: unknown | null;
}

interface AiSessionRow {
  model: string | null;
  spend_cents: number;
  transcript: string;
  proposal: string | null;
}

function ensureAiSession(playerId: string): void {
  db().prepare("INSERT OR IGNORE INTO ai_session(player_id) VALUES(?)").run(playerId);
}

export function getAiSession(playerId: string): AiSession {
  const r = db()
    .prepare("SELECT model, spend_cents, transcript, proposal FROM ai_session WHERE player_id = ?")
    .get(playerId) as AiSessionRow | undefined;
  if (!r) return { model: null, spendCents: 0, transcript: [], proposal: null };
  return {
    model: r.model,
    spendCents: r.spend_cents,
    transcript: safeParse<unknown[]>(r.transcript, []),
    proposal: r.proposal ? safeParse<unknown>(r.proposal, null) : null,
  };
}

/** Pick the session model. The route enforces that this only happens before the
 *  first message (model is locked once a conversation starts). */
export function setAiModel(playerId: string, model: string): void {
  ensureAiSession(playerId);
  db()
    .prepare("UPDATE ai_session SET model = ?, updated_at = datetime('now') WHERE player_id = ?")
    .run(model, playerId);
}

/** Commit one completed turn: bill the tokens, persist the new transcript, and
 *  (when the model proposed a bracket) the latest proposal. Pass `proposal`
 *  undefined to leave the stored proposal untouched. */
export function recordAiTurn(
  playerId: string,
  spendDeltaCents: number,
  transcript: unknown[],
  proposal?: unknown,
): void {
  ensureAiSession(playerId);
  if (proposal !== undefined) {
    db()
      .prepare(
        `UPDATE ai_session
           SET spend_cents = spend_cents + ?, transcript = ?, proposal = ?,
               updated_at = datetime('now')
         WHERE player_id = ?`,
      )
      .run(spendDeltaCents, JSON.stringify(transcript), JSON.stringify(proposal), playerId);
  } else {
    db()
      .prepare(
        `UPDATE ai_session
           SET spend_cents = spend_cents + ?, transcript = ?, updated_at = datetime('now')
         WHERE player_id = ?`,
      )
      .run(spendDeltaCents, JSON.stringify(transcript), playerId);
  }
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
