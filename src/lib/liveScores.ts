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

import { deriveLive, type LiveView } from "./footballData";

const ENDPOINT = "https://api.football-data.org/v4/competitions/WC/matches";

const SEC = 1000;
const TTL_LIVE = 45 * SEC; // a game is in progress — keep it fresh
const TTL_SOON = 3 * 60 * SEC; // kickoff imminent — start watching
const TTL_RECENT = 15 * 60 * SEC; // games finished today — refresh occasionally
const TTL_IDLE = 30 * 60 * SEC; // nothing on — barely poll
const TTL_ERROR = 60 * SEC; // transient failure — retry soon, keep last-good
/** Begin live-cadence polling this far before kickoff. */
const KICKOFF_LEAD_MS = 30 * 60 * SEC;

const EMPTY: LiveView = { live: [], finishedToday: [], nextKickoff: null, fetchedAt: new Date(0).toISOString() };

let cache: { view: LiveView; expiresAt: number } | null = null;
let inflight: Promise<LiveView> | null = null;

/** Adaptive cadence from what the latest fetch showed. */
function ttlFor(view: LiveView): number {
  if (view.live.length > 0) return TTL_LIVE;
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

  const { view } = deriveLive(matches as Parameters<typeof deriveLive>[0]);
  cache = { view, expiresAt: Date.now() + ttlFor(view) };
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
