import type { ReactNode } from "react";
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

/** "9.0%" / "11.4%" — always one decimal so both sides of the arrow match. */
function pct1(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function GameRow({
  g,
  meId,
  baselineWin,
  spiritTeamId,
  possessive,
}: {
  g: FixtureRooting;
  meId: string;
  baselineWin: number;
  spiritTeamId: string | null;
  /** "your" on your own surfaces, "Dejan's" when scouting someone else. */
  possessive: string;
}) {
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

  const spiritInvolved =
    spiritTeamId === g.fixture.home || spiritTeamId === g.fixture.away;
  const spiritWinKey = spiritTeamId === g.fixture.home ? "home" : "away";
  const spiritTeam = spiritTeamId ? TEAMS_BY_ID[spiritTeamId] : null;

  // The verdict line. The team you should root for is the headline:
  // flag + bold name, with the heart commentary tucked in parentheses.
  let verdict: ReactNode;
  let showOdds = false;
  if (!best || spread < MEANINGFUL) {
    verdict =
      spiritInvolved && spiritTeam ? (
        <>
          Root for <Flag code={spiritTeam.flag} />{" "}
          <strong className="text-foreground">{spiritTeam.name}</strong>{" "}
          <span>(💗 nothing at stake — pure spirit)</span>
        </>
      ) : (
        <>Barely moves {possessive} odds — enjoy the game 🍿</>
      );
  } else {
    const team =
      best.outcome === "home" ? home : best.outcome === "away" ? away : null;
    let heart: ReactNode = null;
    if (spiritInvolved) {
      heart =
        best.outcome === spiritWinKey ? (
          <span> (💗 heart and bracket agree)</span>
        ) : (
          <span> (💔 hurts {possessive} spirit team)</span>
        );
    }
    verdict = (
      <>
        Root for{" "}
        {team ? (
          <>
            <Flag code={team.flag} />{" "}
            <strong className="text-foreground">{team.name}</strong>
          </>
        ) : (
          <strong className="text-foreground">a draw</strong>
        )}
        {heart}
      </>
    );
    showOdds = true;
  }

  return (
    <div>
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
        {showOdds && best && (
          <span
            className="text-right whitespace-nowrap tabular-nums"
            title={`Odds to win the pool if this result lands — vs ${pct1(
              worst?.winProb[meId] ?? baselineWin,
            )} if the worst result lands instead.`}
          >
            <span className="text-muted-foreground">
              {pct1(baselineWin)} →{" "}
            </span>
            <span
              className="font-semibold"
              style={{
                color:
                  best.winProb[meId] >= baselineWin
                    ? "var(--pitch)"
                    : "var(--destructive)",
              }}
            >
              {pct1(best.winProb[meId])}
            </span>
            <span className="block eyebrow">{possessive} win odds</span>
          </span>
        )}
      </div>
    </div>
  );
}

export function RootingCard({
  games,
  laterGames,
  meId,
  baselineWin,
  spiritTeamId,
  whose,
}: {
  /** Pre-filtered to the display window — see currentRooting() in lib/odds.ts
   *  (render must stay pure, so the Date.now() cut happens in the caller). */
  games: FixtureRooting[];
  /** Watched fixtures beyond the window — collapsed behind a disclosure. */
  laterGames: FixtureRooting[];
  meId: string;
  /** That player's current P(win pool) — the "from" side of the odds arrow. */
  baselineWin: number;
  spiritTeamId: string | null;
  /** First name when scouting someone else's page; omitted = second person. */
  whose?: string;
}) {
  if (games.length === 0) return null;
  const possessive = whose ? `${whose}'s` : "your";

  return (
    <section className="mt-3 card-surface rounded-xl p-3 border border-border">
      <div className="eyebrow mb-2">
        🎯 {whose ? `Who ${whose} should root for` : "Who to root for in upcoming games"}
      </div>
      <div className="space-y-3">
        {games.map((g) => (
          <GameRow
            key={g.fixture.id}
            g={g}
            meId={meId}
            baselineWin={baselineWin}
            spiritTeamId={spiritTeamId}
            possessive={possessive}
          />
        ))}
      </div>
      {laterGames.length > 0 && (
        // Native disclosure — works in a server component, no JS.
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer select-none">
            {laterGames.length} more game{laterGames.length === 1 ? "" : "s"} in
            the next day
          </summary>
          <div className="mt-3 space-y-3">
            {laterGames.map((g) => (
              <GameRow
                key={g.fixture.id}
                g={g}
                meId={meId}
                baselineWin={baselineWin}
                spiritTeamId={spiritTeamId}
                possessive={possessive}
              />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
