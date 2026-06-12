// Feasibility probe for the Golden Boot side bet. Pushes NOTHING — read-only.
// Answers two free-tier questions before we build/rely on anything:
//   1. /competitions/WC/teams  → are squad rosters populated? (drives full-roster
//      picker vs the curated shortlist fallback)
//   2. /competitions/WC/scorers → are player-level goals populated? (drives auto
//      result resolution vs manual admin entry)
//
//   FOOTBALL_DATA_KEY=xxx node scripts/probe-scorers.mjs [COMP]   (default WC)

const KEY = process.env.FOOTBALL_DATA_KEY;
const COMP = process.argv[2] ?? "WC";
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

const headers = { "X-Auth-Token": KEY };
const base = `https://api.football-data.org/v4/competitions/${COMP}`;

// ── 1. TEAMS / SQUADS ────────────────────────────────────────────────────────
console.log(`\n── ${COMP} /teams → squad availability ──`);
const teamsRes = await fetchWithRetry(`${base}/teams`, { headers });
console.log(`HTTP ${teamsRes.status}`);
if (teamsRes.ok) {
  const { teams = [] } = await teamsRes.json();
  const withSquad = teams.filter((t) => Array.isArray(t.squad) && t.squad.length > 0);
  const totalPlayers = withSquad.reduce((n, t) => n + t.squad.length, 0);
  console.log(`teams: ${teams.length}; with non-empty squad: ${withSquad.length}; total players: ${totalPlayers}`);
  const sample = withSquad[0];
  if (sample) {
    console.log(`sample team "${sample.name}" squad size ${sample.squad.length}; first player:`);
    const p = sample.squad[0];
    console.log(`  ${JSON.stringify({ id: p.id, name: p.name, position: p.position })}`);
  }
  console.log(
    withSquad.length >= 40
      ? "→ FULL ROSTER VIABLE: squads populated on this tier."
      : "→ SQUADS THIN/EMPTY on this tier — use the shortlist fallback.",
  );
} else {
  console.log("error body:", await teamsRes.text());
  console.log("→ /teams not accessible — use the shortlist fallback.");
}

// ── 2. SCORERS ───────────────────────────────────────────────────────────────
console.log(`\n── ${COMP} /scorers → goal data availability ──`);
const scorersRes = await fetchWithRetry(`${base}/scorers?limit=100`, { headers });
console.log(`HTTP ${scorersRes.status}`);
if (scorersRes.ok) {
  const { scorers = [] } = await scorersRes.json();
  console.log(`scorers returned: ${scorers.length}`);
  for (const s of scorers.slice(0, 10)) {
    console.log(`  ${s.goals} ⚽  ${s.player?.name} (${s.team?.name})  [playerId ${s.player?.id}]`);
  }
  console.log(
    scorers.length > 0
      ? "→ AUTO-RESOLUTION VIABLE: top scorer readable from the feed."
      : "→ No scorers yet (or empty on this tier). Re-run after goals are scored; else resolve manually.",
  );
} else {
  console.log("error body:", await scorersRes.text());
  console.log("→ /scorers not accessible — resolve the winner manually post-final.");
}
