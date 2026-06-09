// Format + delay probe for football-data.org. Pushes NOTHING — read-only.
// Hits a competition's /matches endpoint and reports everything poll-scores
// depends on, so we can confirm the free-tier shape against a LIVE competition
// before the World Cup kicks off (when WC is still all TBD/SCHEDULED).
//
//   FOOTBALL_DATA_KEY=xxx node scripts/probe-format.mjs [COMP]   (default BSA)
//
// What we verify (mirrors src/lib/footballData.ts's assumptions):
//   - status enum   (SCHEDULED | IN_PLAY | PAUSED | FINISHED | …)
//   - stage enum    (GROUP_STAGE | LAST_32 | LAST_16 | QUARTER_FINALS | …)
//   - group format  ("GROUP_A" …)  — only present in cups
//   - score.fullTime.{home,away} actually populated on the FREE tier?
//   - score.winner values
//   - DELAY: for any IN_PLAY/PAUSED match, feed minute + lastUpdated vs now.
//
// Free-tier competition codes worth probing: BSA (Brazil, in-season Jun),
// PL/PD/SA/BL1/FL1 (European, off-season Jun), CL, EC, WC.

const KEY = process.env.FOOTBALL_DATA_KEY;
const COMP = process.argv[2] ?? "BSA";
if (!KEY) {
  console.error("FOOTBALL_DATA_KEY is required.");
  process.exit(1);
}

const res = await fetch(`https://api.football-data.org/v4/competitions/${COMP}/matches`, {
  headers: { "X-Auth-Token": KEY },
});

// Rate-limit + freshness headers football-data returns — informative for delay.
const hdr = (n) => res.headers.get(n) ?? "(absent)";
console.log(`\n── ${COMP} /matches → HTTP ${res.status} ──`);
console.log("rate-limit headers:");
for (const h of [
  "X-Requests-Available-Minute",
  "X-RequestCounter-Reset",
  "X-Requested-By",
]) console.log(`  ${h}: ${hdr(h)}`);

if (!res.ok) {
  console.error("error body:", await res.text());
  process.exit(1);
}

const { count, matches = [] } = await res.json();
console.log(`\nmatches returned: ${matches.length}${count ? ` (count=${count})` : ""}`);

const distinct = (sel) => [...new Set(matches.map(sel).filter((x) => x != null))].sort();
console.log("\nstatus values seen: ", distinct((m) => m.status).join(", ") || "(none)");
console.log("stage  values seen: ", distinct((m) => m.stage).join(", ") || "(none)");
console.log("group  values seen: ", distinct((m) => m.group).join(", ") || "(none, league)");
console.log("score.winner seen:  ", distinct((m) => m.score?.winner).join(", ") || "(none)");

// Does the FREE tier actually fill in scores for finished matches?
const finished = matches.filter((m) => m.status === "FINISHED");
const withScore = finished.filter(
  (m) => m.score?.fullTime?.home != null && m.score?.fullTime?.away != null,
);
console.log(
  `\nFINISHED matches: ${finished.length}; with populated fullTime score: ${withScore.length}`,
);
const sample = withScore[withScore.length - 1] ?? finished[finished.length - 1];
if (sample) {
  console.log("sample finished match object (the fields we read):");
  console.log(
    JSON.stringify(
      {
        utcDate: sample.utcDate,
        lastUpdated: sample.lastUpdated,
        status: sample.status,
        stage: sample.stage,
        group: sample.group,
        homeTeam: { name: sample.homeTeam?.name },
        awayTeam: { name: sample.awayTeam?.name },
        score: { winner: sample.score?.winner, fullTime: sample.score?.fullTime },
      },
      null,
      2,
    ),
  );
}

// ── DELAY READING: live matches, feed freshness vs wall clock ──
const now = Date.now();
const live = matches.filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
console.log(`\n── DELAY: ${live.length} live (IN_PLAY/PAUSED) match(es) right now ──`);
if (live.length === 0) {
  const upcoming = matches
    .filter((m) => m.status === "SCHEDULED" || m.status === "TIMED")
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))[0];
  if (upcoming) {
    const mins = Math.round((new Date(upcoming.utcDate) - now) / 60000);
    console.log(
      `No live match. Next kickoff: ${upcoming.homeTeam?.name} v ${upcoming.awayTeam?.name} ` +
        `at ${upcoming.utcDate} (~${mins} min). Re-run mid-match to clock the delay.`,
    );
  } else {
    console.log("No live or scheduled matches found for this competition window.");
  }
} else {
  for (const m of live) {
    const staleSec = Math.round((now - new Date(m.lastUpdated)) / 1000);
    console.log(
      `${m.homeTeam?.name} ${m.score?.fullTime?.home ?? "-"}–${m.score?.fullTime?.away ?? "-"} ` +
        `${m.awayTeam?.name}  [${m.status}]  lastUpdated=${m.lastUpdated} ` +
        `(feed is ${staleSec}s / ${(staleSec / 60).toFixed(1)}min stale vs wall clock)`,
    );
  }
  console.log(
    "\n→ Compare the score(s) above to a real-time source (ESPN/Google) at this exact moment.\n" +
      "  The gap between feed score and reality is the true free-tier delay.",
  );
}
