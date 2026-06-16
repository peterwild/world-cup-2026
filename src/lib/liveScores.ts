// ─────────────────────────────────────────────────────────────────────────────
// The box's fast live-scores read layer. The GitHub Actions cron (every ~20 min)
// owns the authoritative results + odds; it's far too slow to feel "live". So the
// box fetches football-data directly on a short, self-throttling cadence and
// caches the derived LiveView in memory.
//
// One call to /competitions/WC/matches returns every fixture and running score,
// so a single request refreshes ALL concurrent live games at once. Cadence is
// adaptive (see ttlFor): ~45s while a game is in play, minutes when one's about
// to start, and ~30 min when nothing's on — a quiet day costs ~2 calls/hour, a
// match with a live game ~80/hour, both deep inside the 12 calls/min budget.
//
// Needs FOOTBALL_DATA_KEY in the box env (.env.production). Without it, the strip
// degrades to empty rather than erroring.
// ─────────────────────────────────────────────────────────────────────────────

import { deriveLive, deriveMatches, deriveResults, type LiveView } from "./footballData";
import { getResults, setResults } from "./repo";
import { setMatchFeed } from "./matches";
import { recomputeOdds } from "./odds";

const ENDPOINT = "https://api.football-data.org/v4/competitions/WC/matches";

const SEC = 1000;
const TTL_LIVE = 45 * SEC; // a game is in progress — keep it fresh
const TTL_SOON = 3 * 60 * SEC; // kickoff imminent — start watching
const TTL_RECENT = 15 * 60 * SEC; // games finished today — refresh occasionally
const TTL_IDLE = 30 * 60 * SEC; // nothing on — barely poll
const TTL_ERROR = 60 * SEC; // transient failure — retry soon, keep last-good
/** Begin live-cadence polling this far before kickoff. */
const KICKOFF_LEAD_MS = 30 * 60 * SEC;

const EMPTY: LiveView = { live: [], finishedToday: [], nextKickoff: null, awaitingKickoff: false, fetchedAt: new Date(0).toISOString() };

let cache: { view: LiveView; expiresAt: number } | null = null;
let inflight: Promise<LiveView> | null = null;

// ── Event-driven odds ────────────────────────────────────────────────────────
// The box already holds the FULL feed here, ~45s fresh while a game is live (the
// live-scores poll). So instead of waiting up to 20 min for the GitHub cron to
// notice a result, derive the same AUTHORITATIVE results/feed the cron would and
// recompute odds the instant something resolves. Identical deriveResults to the
// cron, so a later cron pass just hash-skips — no conflict, the cron stays as the
// backstop (and still owns the golden-boot scorers call it makes separately).
//
// This is demand-driven: it only fires while someone's hitting /api/live or the
// leaderboard. That's exactly right — during a live game people are watching, so
// odds update within a poll (~45s) of the whistle; when nobody's looking the box
// idles and the cron is the (slower) safety net. Nobody needs instant odds for a
// game nobody's watching.
let lastResultsJson: string | null = null;
function syncOddsFromFeed(matches: Parameters<typeof deriveLive>[0]): void {
  try {
    // Keep the match feed fresh so the watch window / live badges / rooting
    // track real status (cheap KV write; fetchedAt-only churn doesn't move the
    // recompute hash, which keys off played + watched-fixture status).
    const { feed } = deriveMatches(matches);
    setMatchFeed({ ...feed, fetchedAt: new Date().toISOString() });

    // Authoritative results: write only when they actually changed — that change
    // IS the event (a match resolved). Cache the last JSON in-process so we don't
    // re-serialize getResults() against itself every idle poll.
    const { results } = deriveResults(matches);
    const json = JSON.stringify(results);
    if (lastResultsJson === null) lastResultsJson = JSON.stringify(getResults());
    if (json !== lastResultsJson) {
      setResults(results);
      lastResultsJson = json;
    }

    // recomputeOdds hash-guards internally (results + watch window + entry set),
    // so the ~1s sim only runs when something moved — a few times per match day.
    // Deferred off the live-scores response path so /api/live flushes first.
    setImmediate(() => {
      try {
        recomputeOdds();
      } catch (err) {
        console.warn("[liveScores] deferred recomputeOdds failed:", (err as Error).message);
      }
    });
  } catch (err) {
    console.warn("[liveScores] syncOddsFromFeed failed (non-fatal):", (err as Error).message);
  }
}

/** Adaptive cadence from what the latest fetch showed. */
function ttlFor(view: LiveView): number {
  // Hot cadence both while a game's live AND in the kickoff-lag window, so a
  // match that just started (feed still says TIMED) is picked up in seconds
  // rather than after a 30-min idle nap.
  if (view.live.length > 0 || view.awaitingKickoff) return TTL_LIVE;
  if (view.nextKickoff && Date.parse(view.nextKickoff) - Date.now() < KICKOFF_LEAD_MS) return TTL_SOON;
  if (view.finishedToday.length > 0) return TTL_RECENT;
  return TTL_IDLE;
}

/** football-data drops the occasional TLS handshake — retry transiently rather
 *  than surfacing the failure (same posture as scripts/poll-scores.mjs). */
async function fetchWithRetry(key: string, attempts = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(ENDPOINT, { headers: { "X-Auth-Token": key }, signal: AbortSignal.timeout(8000) });
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

async function refresh(): Promise<LiveView> {
  const key = process.env.FOOTBALL_DATA_KEY;
  // No key on the box → degrade to empty (long TTL so we don't spin).
  if (!key) {
    cache = { view: cache?.view ?? EMPTY, expiresAt: Date.now() + TTL_IDLE };
    return cache.view;
  }

  // Never blank live scores on a transient hiccup — hold the last good view and
  // retry on a short TTL (mirrors the cron's empty-feed guard).
  const holdLastGood = (): LiveView => {
    const view = cache?.view ?? EMPTY;
    cache = { view, expiresAt: Date.now() + TTL_ERROR };
    return view;
  };

  let res: Response;
  try {
    res = await fetchWithRetry(key);
  } catch {
    return holdLastGood();
  }
  if (res.status === 429 || !res.ok) return holdLastGood();

  let matches: unknown;
  try {
    ({ matches } = (await res.json()) as { matches?: unknown });
  } catch {
    return holdLastGood();
  }
  // 200-with-empty happens during feed instability — a 104-fixture tournament
  // never legitimately returns zero. Hold rather than wipe the strip.
  if (!Array.isArray(matches) || matches.length === 0) return holdLastGood();

  const fdMatches = matches as Parameters<typeof deriveLive>[0];
  const { view } = deriveLive(fdMatches);
  cache = { view, expiresAt: Date.now() + ttlFor(view) };
  // Event-driven odds: same feed, no extra football-data call. Recompute fires
  // (hash-guarded) within a poll of any result landing. See syncOddsFromFeed.
  syncOddsFromFeed(fdMatches);
  return view;
}

/** The live view, served from cache until its adaptive TTL lapses. Concurrent
 *  callers share a single in-flight fetch. */
export async function getLiveView(): Promise<LiveView> {
  if (cache && Date.now() < cache.expiresAt) return cache.view;
  if (!inflight) {
    inflight = refresh().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
