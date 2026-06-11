import type { EntryOdds } from "@/lib/analytics";

/** "12%"; tiny-but-alive probabilities round to "<1%" instead of a dead "0%". */
export function pct(p: number): string {
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

// The Monte Carlo odds card — shared by the leaderboard ("Your odds") and the
// picks pages. Post-lock only (callers gate); numbers come from the cached
// snapshot the score cron maintains (lib/odds.ts).
export function OddsCard({
  entry,
  sims,
  whose,
}: {
  entry: EntryOdds;
  sims: number;
  /** Card title, e.g. "Your odds" / "Dejan's odds". */
  whose: string;
}) {
  return (
    <section
      className="mt-3 card-surface rounded-xl p-3 border border-border"
      title={`Odds powered by a ${sims.toLocaleString()}-run Monte Carlo simulation. Updated live as games are played.`}
    >
      <div className="eyebrow mb-2">📊 {whose} · updated live</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-bold tabular-nums">{pct(entry.winProb)}</div>
          <div className="eyebrow">win the pool</div>
        </div>
        <div>
          <div className="text-lg font-bold tabular-nums">{pct(entry.top3Prob)}</div>
          <div className="eyebrow">cash (top 3)</div>
        </div>
        <div title="Projected final score — the mean total this bracket lands on across every simulated tournament.">
          <div className="text-lg font-bold tabular-nums">
            {Math.round(entry.expectedTotal)}
          </div>
          <div className="eyebrow">expected points</div>
        </div>
      </div>
    </section>
  );
}
