// ─────────────────────────────────────────────────────────────────────────────
// SQLite persistence via Node's built-in `node:sqlite` (DatabaseSync) — no
// native module, no node-gyp, works on Node 24+. Lives on the Lightsail box at
// data/cup.db; file-based, survives deploys (gitignored). Synchronous API is
// fine for a friend-group-sized pool.
// ─────────────────────────────────────────────────────────────────────────────

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "cup.db");

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec("PRAGMA journal_mode = WAL;"); // safe concurrent reads while the poller writes
  d.exec("PRAGMA foreign_keys = ON;");
  migrate(d);
  seedDefaults(d);
  _db = d;
  return d;
}

/** Insert config defaults once. INSERT OR IGNORE so a redeploy never clobbers
 *  values that have been changed in the live DB. */
function seedDefaults(d: DatabaseSync) {
  const put = d.prepare("INSERT OR IGNORE INTO kv(key, value) VALUES(?, ?)");
  // Env-overridable at first boot (INSERT OR IGNORE — only the first run seeds).
  // Set these in the box's .env.production so the passcode isn't pinned in git.
  const defaults: Record<string, unknown> = {
    [KV.groupName]: process.env.GROUP_NAME ?? "Kitchen Table",
    [KV.groupPasscode]: process.env.GROUP_PASSCODE ?? "kitchentable",
    // 2026 opener: Mexico v South Africa, 3pm ET (EDT = -04:00).
    [KV.lockAt]: process.env.LOCK_AT ?? "2026-06-11T15:00:00-04:00",
    [KV.buyInCents]: Number(process.env.BUY_IN_CENTS ?? 5000),
  };
  for (const [k, v] of Object.entries(defaults)) put.run(k, JSON.stringify(v));
}

function migrate(d: DatabaseSync) {
  d.exec(`
    CREATE TABLE IF NOT EXISTS player (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      venmo       TEXT,
      paid        INTEGER NOT NULL DEFAULT 0,   -- buy-in received (admin toggles)
      is_admin    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- One bracket per player. Picks stored as JSON blobs (prototype-pragmatic).
    --   group_picks: { "A": ["mex","cze","kor","rsa"], ... }  finishing order, slot0=winner
    --   round_teams: { "R32": [...ids], "R16": [...], "QF":[...], "SF":[...], "FINAL":[...], "CHAMPION":[...] }
    CREATE TABLE IF NOT EXISTS bracket (
      player_id              TEXT PRIMARY KEY REFERENCES player(id) ON DELETE CASCADE,
      group_picks            TEXT NOT NULL DEFAULT '{}',
      round_teams            TEXT NOT NULL DEFAULT '{}',
      spirit_team_id         TEXT,
      final_goals_tiebreaker INTEGER,
      submitted_at           TEXT,                -- null = still a draft
      updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Tournament config + live results as key/value JSON. Single source of truth
    -- for the lock time, buy-in, and the actual outcomes the scorer reads.
    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- AI Mode: one research session per player. Budget ($ tracked in cents, counts
    -- UP toward the buy-in) is server-authoritative so a reload/new device can't
    -- reset it. Model is chosen once per session; transcript persists for resume.
    CREATE TABLE IF NOT EXISTS ai_session (
      player_id    TEXT PRIMARY KEY REFERENCES player(id) ON DELETE CASCADE,
      model        TEXT,                          -- chosen model key: opus|sonnet|haiku
      spend_cents  INTEGER NOT NULL DEFAULT 0,    -- game-dollars spent so far (cents)
      transcript   TEXT NOT NULL DEFAULT '[]',    -- JSON ConverseMessage[] for resume
      proposal     TEXT,                          -- last propose_bracket payload (JSON)
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Raw fixtures pulled from football-data.org by the score poller.
    CREATE TABLE IF NOT EXISTS match (
      id          INTEGER PRIMARY KEY,           -- football-data match id
      stage       TEXT,                          -- GROUP_STAGE / LAST_32 / ...
      group_id    TEXT,
      home_id     TEXT,
      away_id     TEXT,
      home_goals  INTEGER,
      away_goals  INTEGER,
      status      TEXT,                          -- SCHEDULED / IN_PLAY / FINISHED
      kickoff_at  TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Idempotent column adds. The CREATE TABLEs above only take effect on a fresh
  // DB; the live box already has these tables, so new columns need an explicit
  // ALTER guarded by a column-existence check.
  addColumnIfMissing(d, "bracket", "ai_assisted", "INTEGER NOT NULL DEFAULT 0");
}

function addColumnIfMissing(
  d: DatabaseSync,
  table: string,
  column: string,
  def: string,
): void {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

// ── kv helpers ───────────────────────────────────────────────────────────────

export function kvGet<T>(key: string, fallback: T): T {
  const row = db().prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

export function kvSet(key: string, value: unknown): void {
  db()
    .prepare("INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

// Well-known kv keys.
export const KV = {
  lockAt: "lock_at",            // ISO string — brackets reject writes after this
  buyInCents: "buy_in_cents",
  groupName: "group_name",
  groupPasscode: "group_passcode",
  results: "results", // the actual tournament outcomes (Results JSON), set by the poller/admin
} as const;

/** Hard lock gate — every bracket write must call this first. */
export function isLocked(now: Date = new Date()): boolean {
  const lockAt = kvGet<string | null>(KV.lockAt, null);
  if (!lockAt) return false;
  return now >= new Date(lockAt);
}
