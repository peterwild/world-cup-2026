import type { EntryOdds, PointsRank } from "@/lib/analytics";
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

/** "2nd", "3rd", "11th" — plain English ordinal. */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// Banked points only ever rise; a negative pointsDelta is a results correction,
// not news (a stored snapshot from before the source fix can still carry one).
// Treat it as no change so the spurious "−N pts" line never renders.
function gainedPoints(delta: EntryDelta | undefined): number {
  return delta ? Math.max(0, delta.pointsDelta) : 0;
}

/** True when there's a real win-prob move worth a "why" line. Points gains live
 *  in the hero now, so they no longer drive this line. */
function oddsMoved(delta: EntryDelta | undefined): boolean {
  return !!delta && (Math.abs(delta.winProbDelta) >= 0.005 || delta.drivers.length > 0);
}

/** The de-emphasized "why your odds moved" line — win-prob move + reason only.
 *  The win-prob figure carries its own up/down color; the reason stays muted so
 *  nothing miscolors a points gain as a loss (banked points are shown, green,
 *  in the hero above). */
function OddsMoveLine({ delta, possessive }: { delta: EntryDelta; possessive: string }) {
  const moved = Math.abs(delta.winProbDelta) >= 0.005;
  const up = delta.winProbDelta > 0;
  const arrow = !moved ? "→" : up ? "↑" : "↓";
  const moveColor = !moved
    ? "var(--muted-foreground)"
    : up
      ? "var(--pitch)"
      : "var(--destructive)";

  const reason =
    delta.drivers.length > 0
      ? delta.drivers.join(", ")
      : up
        ? `the field shifted ${possessive} way`
        : "the field shifted";

  return (
    <div className="mt-2 text-xs flex items-start gap-1.5" style={{ color: "var(--muted-foreground)" }}>
      <span aria-hidden className="font-bold leading-5" style={{ color: moveColor }}>
        {arrow}
      </span>
      <span className="leading-5">
        {moved && (
          <>
            <span className="font-semibold tabular-nums" style={{ color: moveColor }}>
              {fmtWinDelta(delta.winProbDelta)} to win
            </span>
            {" — "}
          </>
        )}
        {reason}
      </span>
    </div>
  );
}

// The standing card — shared by the leaderboard ("Your odds") and the picks
// pages. Banked points are the hero now that games are scoring; the Monte Carlo
// odds (win pool / win cash / projected final) sit underneath as context.
// Post-lock only (callers gate); numbers come from the cached snapshot the
// score cron maintains (lib/odds.ts).
export function OddsCard({
  entry,
  sims,
  delta,
  rank,
  computedAt,
  pending,
  possessive = "your",
}: {
  entry: EntryOdds;
  sims: number;
  /** Why these odds moved since the last recompute (lib/oddsDelta). */
  delta?: EntryDelta;
  /** This entry's standing by banked points (lib/analytics.pointsRank). */
  rank?: PointsRank | null;
  /** ISO time the snapshot was computed — drives the "updated X ago" line. */
  computedAt?: string;
  /** A live/just-kicked-off game whose result isn't folded in yet. */
  pending?: string | null;
  /** Whose card this is, as a possessive — "your" or "Stephanie's". Drives the
   *  eyebrows ("Your standing" / "Your odds") and the delta reason. */
  possessive?: string;
}) {
  const gain = gainedPoints(delta);
  const rankLabel = rank ? `${rank.tied ? "T-" : ""}${ordinal(rank.rank)}` : null;
  // "your" → "Your", "Stephanie's" → "Stephanie's" (already capitalized).
  const who = possessive.charAt(0).toUpperCase() + possessive.slice(1);

  return (
    <section
      className="mt-3 card-surface rounded-xl p-3 border border-border"
      title={`Odds powered by a ${sims.toLocaleString()}-run Monte Carlo simulation. Updated live as games are played.`}
    >
      <div className="eyebrow mb-2">
        📊 {who} standing
        {computedAt && <> · <UpdatedAgo computedAt={computedAt} pending={!!pending} /></>}
      </div>

      {/* Hero: banked points (+ recent gain) and standing by points */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tabular-nums leading-none">
            {entry.currentTotal}
          </span>
          <span className="eyebrow">points</span>
          {gain > 0 && (
            <span
              className="text-sm font-semibold tabular-nums"
              style={{ color: "var(--pitch)" }}
            >
              ↑ +{gain}
            </span>
          )}
        </div>
        {rankLabel && (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold tabular-nums leading-none">
              {rankLabel}
            </span>
            <span className="eyebrow">of {rank!.field}</span>
          </div>
        )}
      </div>

      {/* Odds, demoted to context under the points */}
      <div className="mt-3 pt-3 border-t border-border">
        <div className="eyebrow mb-2">{who} odds</div>
        <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-sm font-semibold tabular-nums">{pct(entry.winProb)}</div>
          <div className="eyebrow">win the pool</div>
        </div>
        <div>
          <div className="text-sm font-semibold tabular-nums">{pct(entry.top3Prob)}</div>
          <div className="eyebrow">win cash (top 3)</div>
        </div>
        <div title="Projected final score — the mean total this bracket lands on across every simulated tournament.">
          <div className="text-sm font-semibold tabular-nums">
            {Math.round(entry.expectedTotal)}
          </div>
          <div className="eyebrow">projected</div>
        </div>
        </div>
      </div>

      {delta && oddsMoved(delta) && <OddsMoveLine delta={delta} possessive={possessive} />}
    </section>
  );
}
