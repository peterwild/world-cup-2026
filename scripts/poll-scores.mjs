// Pulls World Cup matches from football-data.org, derives results, and pushes
// them to the box's authed admin endpoint. Run by GitHub Actions cron.
//   node --import ./scripts/ts-ext-resolver.mjs scripts/poll-scores.mjs [--dry-run]
//
// Env: FOOTBALL_DATA_KEY (required), SITE_URL + ADMIN_KEY (required to push).
import { deriveResults } from "../src/lib/footballData.ts";

const KEY = process.env.FOOTBALL_DATA_KEY;
const SITE = process.env.SITE_URL;
const ADMIN = process.env.ADMIN_KEY;
const DRY = process.argv.includes("--dry-run");

if (!KEY) {
  console.error("FOOTBALL_DATA_KEY is required.");
  process.exit(1);
}

const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
  headers: { "X-Auth-Token": KEY },
});
if (!res.ok) {
  console.error("football-data error:", res.status, await res.text());
  process.exit(1);
}

const { matches = [] } = await res.json();
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
