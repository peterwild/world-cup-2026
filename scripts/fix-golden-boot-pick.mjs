// One-off admin fix: set (or inspect) a player's Golden Boot pick directly in
// the box DB, bypassing the end-of-group-stage lock that blocks the normal
// POST /api/golden-boot path.
//
// Run ON THE BOX from the app dir (~/world-cup-2026), where data/cup.db lives:
//
//   # 1. Inspect only (dry run — also serves as the diagnostic):
//   node scripts/fix-golden-boot-pick.mjs --player "Tim" --pick "Mbapp"
//
//   # 2. Apply the fix once you've confirmed the matched player + candidate:
//   node scripts/fix-golden-boot-pick.mjs --player "Tim" --pick "Mbapp" --apply
//
// --player / --pick are case-insensitive substring matches. The script refuses
// to write unless each matches exactly one row, so a dry run first is safe.
// No pm2 restart needed: golden_boot reads hit the DB live (WAL mode).

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const PLAYER_Q = (arg("--player") ?? "").trim();
const PICK_Q = (arg("--pick") ?? "").trim();
const APPLY = process.argv.includes("--apply");

if (!PLAYER_Q || !PICK_Q) {
  console.error('Usage: node scripts/fix-golden-boot-pick.mjs --player "Tim" --pick "Mbapp" [--apply]');
  process.exit(1);
}

const db = new DatabaseSync(path.join(process.cwd(), "data", "cup.db"));
db.exec("PRAGMA journal_mode = WAL;");

// ── Resolve the candidate (pickId) from the active candidate set ──────────────
// The picker reads golden_boot_roster KV (full fd roster) and falls back to the
// curated shortlist when that's absent. We mirror that here so the id we write
// is exactly what the live app expects.
let candidates = [];
const rosterRow = db.prepare("SELECT value FROM kv WHERE key = 'golden_boot_roster'").get();
if (rosterRow?.value) {
  try {
    const r = JSON.parse(rosterRow.value);
    if (Array.isArray(r) && r.length) candidates = r;
  } catch {
    /* fall through to shortlist note below */
  }
}
const candidateSource = candidates.length ? "golden_boot_roster KV (full roster)" : "SHORTLIST_FALLBACK";
if (!candidates.length) {
  // Minimal mirror of SHORTLIST_FALLBACK for Mbappé; extend if you ever need
  // another shortlist name. (If the roster KV is loaded this branch is dead.)
  candidates = [{ id: "gb-mbappe", name: "Kylian Mbappé", teamId: "fra" }];
}

const norm = (s) => (s ?? "").toLowerCase();
const pickMatches = candidates.filter((c) => norm(c.name).includes(norm(PICK_Q)));

console.log(`Candidate source: ${candidateSource} (${candidates.length} candidates)`);
console.log(`\nPick matches for "${PICK_Q}": ${pickMatches.length}`);
for (const c of pickMatches) console.log(`  id=${c.id}  name=${c.name}  team=${c.teamId}`);

// ── Resolve the player ───────────────────────────────────────────────────────
const players = db
  .prepare("SELECT id, name, created_at FROM player WHERE lower(name) LIKE ? ORDER BY name")
  .all(`%${PLAYER_Q.toLowerCase()}%`);

console.log(`\nPlayer matches for "${PLAYER_Q}": ${players.length}`);
for (const p of players) {
  const gb = db
    .prepare("SELECT status, pick_id, paid, decided_at, updated_at FROM golden_boot WHERE player_id = ?")
    .get(p.id);
  const pickName = gb?.pick_id ? candidates.find((c) => c.id === gb.pick_id)?.name ?? "(unknown id)" : null;
  console.log(`  ${p.name}  (id=${p.id})`);
  if (!gb) {
    console.log(`     golden_boot: NO ROW — never opted in / declined (snooze is client-side only)`);
  } else {
    console.log(
      `     golden_boot: status=${gb.status}  pick=${gb.pick_id ?? "(none)"}` +
        `${pickName ? ` [${pickName}]` : ""}  paid=${gb.paid}` +
        `  decided_at=${gb.decided_at ?? "?"}  updated_at=${gb.updated_at ?? "?"}`,
    );
  }
}

// ── Guard rails before writing ───────────────────────────────────────────────
if (pickMatches.length !== 1) {
  console.error(`\nRefusing to proceed: --pick "${PICK_Q}" must match exactly 1 candidate (got ${pickMatches.length}). Narrow it.`);
  process.exit(1);
}
if (players.length !== 1) {
  console.error(`\nRefusing to proceed: --player "${PLAYER_Q}" must match exactly 1 player (got ${players.length}). Narrow it.`);
  process.exit(1);
}

const player = players[0];
const pick = pickMatches[0];

if (!APPLY) {
  console.log(
    `\nDRY RUN. Would set ${player.name} (${player.id}) → status='in', pick_id='${pick.id}' (${pick.name}).` +
      `\nRe-run with --apply to write.`,
  );
  process.exit(0);
}

// Upsert: opt them in (sticky decided_at) and set the pick. Mirrors
// setGoldenBootStatus + setGoldenBootPick in src/lib/repo.ts.
db.prepare(
  `INSERT INTO golden_boot(player_id, status, pick_id, decided_at)
   VALUES(?, 'in', ?, datetime('now'))
   ON CONFLICT(player_id) DO UPDATE
     SET status = 'in',
         pick_id = excluded.pick_id,
         decided_at = COALESCE(golden_boot.decided_at, excluded.decided_at),
         updated_at = datetime('now')`,
).run(player.id, pick.id);

const after = db
  .prepare("SELECT status, pick_id, paid, decided_at, updated_at FROM golden_boot WHERE player_id = ?")
  .get(player.id);
console.log(`\nAPPLIED. ${player.name} → status=${after.status} pick_id=${after.pick_id} (${pick.name}) updated_at=${after.updated_at}`);
console.log("Note: paid flag left as-is — toggle the Golden Boot buy-in on the /admin page if he owes the extra $20.");
