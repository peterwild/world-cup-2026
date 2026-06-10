import type { EntryOdds } from "@/lib/analytics";

/** "12%"; tiny-but-alive probabilities round to "<1%" instead of a dead "0%". */
export function pct(p: number): string {
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

export function ordinal(n: number): string {
  const v = Math.round(n);
  const m = v % 100;
  const suffix =
    m >= 11 && m <= 13 ? "th" : ["th", "st", "nd", "rd"][v % 10 < 4 ? v % 10 : 0];
  return `${v}${suffix}`;
}

// The Monte Carlo odds card — shared by the leaderboard ("Your odds") and the
// picks pages. Post-lock only (callers gate); numbers come from the cached
// snapshot the score cron maintains (lib/odds.ts).
export function OddsCard({
  entry,
  sims,
  population,
  whose,
}: {
  entry: EntryOdds;
  sims: number;
  population: number;
  /** Card title, e.g. "Your odds" / "Dejan's odds". */
  whose: string;
}) {
  return (
    <section className="mt-3 card-surface rounded-xl p-3 border border-border">
      <div className="eyebrow mb-2">📊 {whose}</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold tabular-nums">{pct(entry.winProb)}</div>
          <div className="eyebrow">win the pool</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums">{pct(entry.top3Prob)}</div>
          <div className="eyebrow">cash (top 3)</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums">
            {ordinal(entry.popPercentile)}
          </div>
          <div className="eyebrow">percentile*</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        *Percentile compares you to the world, not this pool: this bracket is on
        track to beat {Math.round(entry.popPercentile)}% of {population}{" "}
        computer-generated brackets.
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        All three numbers come from {sims.toLocaleString()} simulations of the
        rest of the tournament and update as results come in.
      </p>
    </section>
  );
}
