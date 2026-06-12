// Pulls World Cup matches from football-data.org (ONE call per run — the whole
// schedule, scores, and standings come from a single endpoint, so we stay deep
// inside the free tier's 10 calls/minute). Derives results and pushes them to
// the box's authed admin endpoint. Run by GitHub Actions cron.
//   node --import ./scripts/ts-ext-resolver.mjs scripts/poll-scores.mjs [--dry-run|--print-groups]
//
// Env: FOOTBALL_DATA_KEY (required), SITE_URL + ADMIN_KEY (required to push).
import { deriveMatches, deriveResults, groupsFromMatches, deriveScorers } from "../src/lib/footballData.ts";
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

// football-data drops the occasional TLS handshake (ECONNRESET / "other side
// closed"). Those are transient — retry a couple times in-run rather than
// failing the whole job and waiting ~20 min for the next cron.
async function fetchWithRetry(url, init, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (i === attempts) throw err;
      const wait = 2000 * i; // 2s, 4s
      console.warn(`fetch failed (attempt ${i}/${attempts}): ${err.cause?.code ?? err.message} — retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

const res = await fetchWithRetry("https://api.football-data.org/v4/competitions/WC/matches", {
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

// football-data occasionally returns 200 with an empty matches array during
// instability (observed pre-tournament). The WC schedule is 104 fixtures from
// the moment the bracket is published, so an empty feed is never legitimate —
// pushing it would wipe live standings on the box. Skip; the next run catches up.
if (matches.length === 0) {
  console.warn("Empty matches array from football-data (transient) — skipping push; next run retries.");
  process.exit(0);
}

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
console.log("push results:", push.status, await push.text());

// Match-level feed (played group matches + upcoming fixtures) — feeds the
// sim's mid-group conditioning and the "who to root for" view. Same response
// body, zero extra football-data calls.
const { feed } = deriveMatches(matches);
console.log(`feed: ${feed.played.length} played group matches, ${feed.upcoming.length} upcoming fixtures`);
const pushFeed = await fetch(`${SITE}/api/admin/matches`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-admin-key": ADMIN },
  body: JSON.stringify(feed),
});
console.log("push matches:", pushFeed.status, await pushFeed.text());

// Golden Boot live goal table — a SECOND football-data call (still inside the
// free tier's 10/min). Best-effort: a scorers hiccup must never fail the run
// that already pushed the authoritative results above.
try {
  const sres = await fetchWithRetry("https://api.football-data.org/v4/competitions/WC/scorers?limit=100", {
    headers: { "X-Auth-Token": KEY },
  });
  if (sres.ok) {
    const { scorers = [] } = await sres.json();
    const { standings, unmapped } = deriveScorers(scorers);
    if (unmapped.length) console.warn("⚠️  Unmapped scorer teams:", unmapped);
    const pushScorers = await fetch(`${SITE}/api/admin/golden-boot`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": ADMIN },
      body: JSON.stringify({ op: "scorers", scorers: standings }),
    });
    console.log(`push scorers (${standings.length}):`, pushScorers.status, await pushScorers.text());
  } else {
    console.warn("scorers fetch non-OK:", sres.status, "— skipping (results already pushed).");
  }
} catch (err) {
  console.warn("scorers step failed (non-fatal):", err.message);
}

if (!push.ok || !pushFeed.ok) process.exit(1);
