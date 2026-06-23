import type { EntryOdds } from "@/lib/analytics";
import type { EntryDelta } from "@/lib/oddsDelta";
import { UpdatedAgo } from "./OddsFreshness";

/** "12%"; tiny-but-alive probabilities round to "<1%" instead of a dead "0%". */
export function pct(p: number): string {
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

/** A signed win-probability move as percentage points: "+3%", "−2%", "<1%".
 *  Below half a point reads as no move. */
function fmtWinDelta(d: number): string {
  const pts = Math.round(d * 100);
  if (pts === 0) return d > 0 ? "<1%" : d < 0 ? "−<1%" : "0%";
  return `${pts > 0 ? "+" : "−"}${Math.abs(pts)}%`;
}

// Banked points only ever rise; a negative pointsDelta is a results correction,
// not news (a stored snapshot from before the source fix can still carry one).
// Treat it as no change so the spurious "−N pts" line never renders.
function gainedPoints(delta: EntryDelta): number {
  return Math.max(0, delta.pointsDelta);
}

/** True when a delta is worth a line — a real win-prob move, a points gain,
 *  or at least one named driver. */
function moved(delta: EntryDelta): boolean {
  return Math.abs(delta.winProbDelta) >= 0.005 || gainedPoints(delta) > 0 || delta.drivers.length > 0;
}

/** The one-line "why your odds moved" explanation. Drivers are ground truth;
 *  when none of the player's own teams resolved, the move came from the field
 *  shifting around them — say that rather than invent a personal reason. */
function DeltaLine({ delta, possessive }: { delta: EntryDelta; possessive: string }) {
  const pts = gainedPoints(delta);
  const up = delta.winProbDelta > 0 || (delta.winProbDelta === 0 && pts > 0);
  const flat = delta.winProbDelta === 0 && pts === 0 && delta.drivers.length === 0;
  const tone = flat ? "var(--muted-foreground)" : up ? "var(--pitch)" : "var(--destructive)";
  const arrow = flat ? "→" : up ? "↑" : "↓";

  const stats = [
    Math.abs(delta.winProbDelta) >= 0.005 ? `${fmtWinDelta(delta.winProbDelta)} to win` : null,
    pts > 0 ? `+${pts} pts` : null,
  ].filter(Boolean);

  const reason =
    delta.drivers.length > 0
      ? delta.drivers.join(", ")
      : up
        ? `the field shifted ${possessive} way`
        : "the field shifted";

  return (
    <div className="mt-2 text-xs flex items-start gap-1.5" style={{ color: tone }}>
      <span aria-hidden className="font-bold leading-5">{arrow}</span>
      <span className="leading-5">
        {stats.length > 0 && <span className="font-semibold tabular-nums">{stats.join(" · ")}</span>}
        {stats.length > 0 && " — "}
        {reason}
      </span>
    </div>
  );
}

// The Monte Carlo odds card — shared by the leaderboard ("Your odds") and the
// picks pages. Post-lock only (callers gate); numbers come from the cached
// snapshot the score cron maintains (lib/odds.ts).
export function OddsCard({
  entry,
  sims,
  whose,
  delta,
  computedAt,
  pending,
  possessive = "your",
}: {
  entry: EntryOdds;
  sims: number;
  /** Card title, e.g. "Your odds" / "Dejan's odds". */
  whose: string;
  /** Why these odds moved since the last recompute (lib/oddsDelta). */
  delta?: EntryDelta;
  /** ISO time the snapshot was computed — drives the "updated X ago" line. */
  computedAt?: string;
  /** A live/just-kicked-off game whose result isn't folded in yet. */
  pending?: string | null;
  /** Inline possessive for the delta reason — "your" or "Stephanie's". */
  possessive?: string;
}) {
  return (
    <section
      className="mt-3 card-surface rounded-xl p-3 border border-border"
      title={`Odds powered by a ${sims.toLocaleString()}-run Monte Carlo simulation. Updated live as games are played.`}
    >
      <div className="eyebrow mb-2">
        📊 {whose}
        {computedAt && <> · <UpdatedAgo computedAt={computedAt} pending={!!pending} /></>}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold tabular-nums">{pct(entry.winProb)}</div>
          <div className="eyebrow">win the pool</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums">{pct(entry.top3Prob)}</div>
          <div className="eyebrow">win cash (top 3)</div>
        </div>
        <div title="Projected final score — the mean total this bracket lands on across every simulated tournament.">
          <div className="text-lg font-bold tabular-nums">
            {Math.round(entry.expectedTotal)}
          </div>
          <div className="eyebrow">expected points</div>
        </div>
      </div>
      {delta && moved(delta) && <DeltaLine delta={delta} possessive={possessive} />}
    </section>
  );
}
