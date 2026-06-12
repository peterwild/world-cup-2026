// Builds the Golden Boot candidate roster from football-data /teams squads and
// pushes it to the box's `golden_boot_roster` KV (the picker reads it via
// getCandidates(); absent/empty → curated shortlist fallback).
//
//   node --import ./scripts/ts-ext-resolver.mjs scripts/fetch-roster.mjs [--print]
//
// Env: FOOTBALL_DATA_KEY (required); SITE_URL + ADMIN_KEY (required to push,
// not needed with --print). One-time run after the probe confirms squads exist.
import { nameToId } from "../src/lib/footballData.ts";

const KEY = process.env.FOOTBALL_DATA_KEY;
const SITE = process.env.SITE_URL;
const ADMIN = process.env.ADMIN_KEY;
const PRINT = process.argv.includes("--print");
const COMP = "WC";

if (!KEY) {
  console.error("FOOTBALL_DATA_KEY is required.");
  process.exit(1);
}

async function fetchWithRetry(url, init, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (i === attempts) throw err;
      const wait = 2000 * i;
      console.warn(`fetch failed (attempt ${i}/${attempts}): ${err.cause?.code ?? err.message} — retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const res = await fetchWithRetry(`https://api.football-data.org/v4/competitions/${COMP}/teams`, {
  headers: { "X-Auth-Token": KEY },
});
if (!res.ok) {
  console.error("football-data /teams error:", res.status, await res.text());
  process.exit(1);
}

const { teams = [] } = await res.json();
const candidates = [];
const unmapped = new Set();
for (const t of teams) {
  const teamId = nameToId(t.name);
  if (!teamId) {
    unmapped.add(t.name);
    continue;
  }
  for (const p of t.squad ?? []) {
    if (!p?.id || !p?.name) continue;
    candidates.push({ id: String(p.id), name: p.name, teamId });
  }
}

console.log(`Built ${candidates.length} candidates from ${teams.length} teams.`);
if (unmapped.size) console.log("Unmapped team names (add aliases in footballData.ts):", [...unmapped]);

if (candidates.length === 0) {
  console.error("No squad players found — squads likely unavailable on this tier. Keep the shortlist fallback.");
  process.exit(1);
}

if (PRINT) {
  console.log(JSON.stringify(candidates.slice(0, 20), null, 2));
  console.log(`… (${candidates.length} total)`);
  process.exit(0);
}

if (!SITE || !ADMIN) {
  console.error("SITE_URL and ADMIN_KEY are required to push (or use --print).");
  process.exit(1);
}

const push = await fetch(`${SITE}/api/admin/golden-boot`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-key": ADMIN },
  body: JSON.stringify({ op: "roster", candidates }),
});
console.log("push roster:", push.status, await push.text());
if (!push.ok) process.exit(1);
