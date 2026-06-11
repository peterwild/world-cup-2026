import { TEAMS_BY_ID } from "@/lib/teams";
import type { FixtureRooting, RootingOutcome } from "@/lib/analytics";
import { Flag } from "@/components/Flag";

// "Who to root for" — for each upcoming game, which result most improves YOUR
// odds of winning the pool. Conditional probabilities read straight from the
// odds snapshot's rooting buckets (lib/analytics.ts); no compute here.

/** Below this, a game genuinely doesn't move your odds — say so. */
const MEANINGFUL = 0.003;

function kickoffLabel(iso: string, status: string): string {
  if (status === "IN_PLAY" || status === "PAUSED") return "🔴 live now";
  const t = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(iso));
  return `${t} ET`;
}

function signedPct(d: number): string {
  return `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`;
}

export function RootingCard({
  games,
  later,
  meId,
  baselineWin,
  spiritTeamId,
  sims,
}: {
  /** Pre-filtered to the display window — see currentRooting() in lib/odds.ts
   *  (render must stay pure, so the Date.now() cut happens in the caller). */
  games: FixtureRooting[];
  /** Watched fixtures beyond the window — shown as a "+N more" line. */
  later: number;
  meId: string;
  /** Your current P(win pool) — deltas are measured against this. */
  baselineWin: number;
  spiritTeamId: string | null;
  sims: number;
}) {
  if (games.length === 0) return null;

  return (
    <section className="mt-3 card-surface rounded-xl p-3 border border-border">
      <div className="eyebrow mb-2">🎯 Who to root for</div>
      <div className="space-y-3">
        {games.map((g) => {
          const home = TEAMS_BY_ID[g.fixture.home];
          const away = TEAMS_BY_ID[g.fixture.away];
          if (!home || !away) return null;

          // Best/worst result for YOU.
          const mine = g.outcomes.filter((o) => o.winProb[meId] !== undefined);
          let best: RootingOutcome | null = null;
          let worst: RootingOutcome | null = null;
          for (const o of mine) {
            if (!best || o.winProb[meId] > best.winProb[meId]) best = o;
            if (!worst || o.winProb[meId] < worst.winProb[meId]) worst = o;
          }
          const spread = best && worst ? best.winProb[meId] - worst.winProb[meId] : 0;
          const delta = best ? best.winProb[meId] - baselineWin : 0;

          const spiritInvolved =
            spiritTeamId === g.fixture.home || spiritTeamId === g.fixture.away;
          const spiritWinKey = spiritTeamId === g.fixture.home ? "home" : "away";
          const spiritName = spiritTeamId
            ? (TEAMS_BY_ID[spiritTeamId]?.name ?? "")
            : "";

          let verdict: string;
          let showDelta = false;
          if (!best || spread < MEANINGFUL) {
            verdict = spiritInvolved
              ? `Root for ${spiritName} — no points at stake, pure 💗`
              : "Barely moves your odds — enjoy the game 🍿";
          } else {
            const target =
              best.outcome === "draw"
                ? "a draw"
                : best.outcome === "home"
                  ? home.name
                  : away.name;
            verdict = `Root for ${target}`;
            if (spiritInvolved) {
              verdict +=
                best.outcome === spiritWinKey
                  ? " — heart and bracket agree 💗"
                  : ` 💔 (your heart says ${spiritName})`;
            }
            showDelta = true;
          }

          return (
            <div key={g.fixture.id}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium min-w-0">
                  <Flag code={home.flag} />
                  <span className="truncate">{home.name}</span>
                  <span className="text-muted-foreground text-xs">vs</span>
                  <Flag code={away.flag} />
                  <span className="truncate">{away.name}</span>
                </span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {kickoffLabel(g.fixture.kickoff, g.fixture.status)}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{verdict}</span>
                {showDelta && (
                  <span
                    className="tabular-nums font-semibold whitespace-nowrap"
                    title={`Your win odds if it happens, vs ${signedPct(
                      (worst?.winProb[meId] ?? baselineWin) - baselineWin,
                    )} in the worst case`}
                    style={{ color: delta >= 0 ? "var(--pitch)" : "var(--destructive)" }}
                  >
                    {signedPct(delta)} win odds
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {later > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          + {later} more game{later === 1 ? "" : "s"} the day after.
        </p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        Each game&apos;s best result for YOUR bracket, from the same{" "}
        {sims.toLocaleString()} simulations as your odds.
      </p>
    </section>
  );
}
