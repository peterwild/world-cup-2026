// Pulls World Cup matches from football-data.org (ONE call per run — the whole
// schedule, scores, and standings come from a single endpoint, so we stay deep
// inside the free tier's 10 calls/minute). Derives results and pushes them to
// the box's authed admin endpoint. Run by GitHub Actions cron.
//   node --import ./scripts/ts-ext-resolver.mjs scripts/poll-scores.mjs [--dry-run|--print-groups]
//
// Env: FOOTBALL_DATA_KEY (required), SITE_URL + ADMIN_KEY (required to push).
import { deriveResults, groupsFromMatches } from "../src/lib/footballData.ts";
import { GROUP_IDS, TEAMS, TEAMS_BY_ID } from "../src/lib/teams.ts";

const KEY = process.env.FOOTBALL_DATA_KEY;
const SITE = process.env.SITE_URL;
const ADMIN = process.env.ADMIN_KEY;
const DRY = process.argv.includes("--dry-run");
const PRINT_GROUPS = process.argv.includes("--print-groups");

if (!KEY) {
  console.error("FOOTBALL_DATA_KEY is required.");
  process.exit(1);
}

const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
  headers: { "X-Auth-Token": KEY },
});
// Free-tier rate limit — don't fail the run, the next cron will catch up.
if (res.status === 429) {
  console.warn("Rate-limited (429) by football-data free tier — skipping; next run retries.");
  process.exit(0);
}
if (!res.ok) {
  console.error("football-data error:", res.status, await res.text());
  process.exit(1);
}

const { matches = [] } = await res.json();

// ── Draw verification: compare the live feed's groups to our seed (teams.ts) ──
if (PRINT_GROUPS) {
  const { groups: feedIds, unmapped } = groupsFromMatches(matches);
  const seed = {};
  for (const t of TEAMS) (seed[t.group] ??= []).push(t.id);
  const feedNames = {};
  for (const m of matches) {
    if (m.stage !== "GROUP_STAGE" || !m.group) continue;
    const g = m.group.replace("GROUP_", "");
    (feedNames[g] ??= new Set());
    for (const n of [m.homeTeam.name, m.awayTeam.name]) if (n) feedNames[g].add(n);
  }
  let allMatch = true;
  for (const g of GROUP_IDS) {
    const fids = (feedIds[g] ?? []).slice().sort();
    const sids = (seed[g] ?? []).slice().sort();
    const same = fids.length === sids.length && fids.every((x, i) => x === sids[i]);
    if (!same) allMatch = false;
    console.log(`Group ${g}: ${same ? "✓" : "✗ DIFFERS"}`);
    console.log(`   feed: ${[...(feedNames[g] ?? [])].sort().join(", ")}`);
    if (!same) {
      console.log(`   seed: ${sids.map((id) => TEAMS_BY_ID[id]?.name ?? id).join(", ")}`);
    }
  }
  console.log(
    allMatch
      ? "\nALL 12 GROUPS MATCH ✓ — safe to flip TEAMS_VERIFIED=true"
      : "\n✗ MISMATCHES above — reconcile teams.ts before lock",
  );
  if (unmapped.length) console.log("Unmapped feed names (add aliases):", unmapped);
  process.exit(0);
}

const { results, unmapped } = deriveResults(matches);
if (unmapped.length) {
  console.warn("⚠️  Unmapped team names — add to ALIASES in footballData.ts:", unmapped);
}
console.log(
  `Parsed ${matches.length} matches → groups set: ${Object.keys(results.groupResults).length}/12, champion: ${results.roundTeams.CHAMPION?.[0] ?? "TBD"}`,
);

if (DRY) {
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
if (!SITE || !ADMIN) {
  console.error("SITE_URL and ADMIN_KEY are required to push results.");
  process.exit(1);
}

const push = await fetch(`${SITE}/api/admin/results`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-key": ADMIN },
  body: JSON.stringify(results),
});
console.log("push:", push.status, await push.text());
if (!push.ok) process.exit(1);
