import type { ReactNode } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import type { FixtureRooting } from "@/lib/analytics";
import { type BackDepth, backedSide, backDepthPhrase } from "@/lib/bracketState";
import { Flag } from "@/components/Flag";
import { isInPlay } from "@/lib/footballData";

// "Who to root for" — for each upcoming game, the team YOUR bracket carries
// further. Read straight off your picks (lib/bracketState), never from pool
// math, so the call is always the team you actually picked. The only twist on
// top is your spirit team: if it's playing and your bracket has no stake, root
// for it; if it's playing AGAINST your bracket pick, we say so.

function kickoffLabel(iso: string, status: string): string {
  if (isInPlay(status)) return "🔴 live now";
  const t = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(iso));
  return `${t} ET`;
}

function GameRow({
  g,
  back,
  spiritTeamId,
  possessive,
}: {
  g: FixtureRooting;
  back: BackDepth;
  spiritTeamId: string | null;
  /** "your" on your own surfaces, "Dejan's" when scouting someone else. */
  possessive: string;
}) {
  const home = TEAMS_BY_ID[g.fixture.home];
  const away = TEAMS_BY_ID[g.fixture.away];
  if (!home || !away) return null;

  // The team your bracket carries further in this game (null = no stake).
  const side = backedSide(g.fixture.home, g.fixture.away, back);
  const backedId = side === "home" ? g.fixture.home : side === "away" ? g.fixture.away : null;
  const backedTeam = side === "home" ? home : side === "away" ? away : null;

  const spiritInvolved =
    spiritTeamId === g.fixture.home || spiritTeamId === g.fixture.away;
  const spiritTeam = spiritTeamId ? TEAMS_BY_ID[spiritTeamId] : null;

  // The verdict line. The team you should root for is the headline:
  // flag + bold name, with the "why" tucked in parentheses.
  let verdict: ReactNode;
  if (!backedTeam) {
    // No bracket stake. Root for your spirit team if it's in this game, else
    // it's a free watch.
    verdict =
      spiritInvolved && spiritTeam ? (
        <>
          Root for <Flag code={spiritTeam.flag} />{" "}
          <strong className="text-foreground">{spiritTeam.name}</strong>{" "}
          <span>(💗 nothing on your card — pure spirit)</span>
        </>
      ) : (
        <>No stake for {possessive} bracket — enjoy the game 🍿</>
      );
  } else {
    const phrase = backDepthPhrase(back[backedId!] ?? 0, possessive);
    let heart: ReactNode = null;
    if (spiritInvolved) {
      // Spirit team is in this game. If it IS your backed team, hearts align;
      // otherwise rooting for your bracket pick means rooting against it.
      heart =
        spiritTeamId === backedId ? (
          <span> (💗 heart and bracket agree)</span>
        ) : (
          <span> (💔 against {possessive} spirit team)</span>
        );
    }
    verdict = (
      <>
        Root for <Flag code={backedTeam.flag} />{" "}
        <strong className="text-foreground">{backedTeam.name}</strong>{" "}
        <span className="text-muted-foreground">— {phrase}</span>
        {heart}
      </>
    );
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
      <div className="mt-0.5 text-xs text-muted-foreground">{verdict}</div>
    </div>
  );
}

export function RootingCard({
  games,
  laterGames,
  back,
  spiritTeamId,
  whose,
}: {
  /** Pre-filtered to the display window — see currentRooting() in lib/odds.ts
   *  (render must stay pure, so the Date.now() cut happens in the caller). The
   *  fixtures supply WHICH games are coming up; the recommendation comes from
   *  `back`, not their conditional buckets. */
  games: FixtureRooting[];
  /** Watched fixtures beyond the window — collapsed behind a disclosure. */
  laterGames: FixtureRooting[];
  /** How deep this player's bracket backs each team (lib/bracketState). */
  back: BackDepth;
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
            back={back}
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
            the next few days
          </summary>
          <div className="mt-3 space-y-3">
            {laterGames.map((g) => (
              <GameRow
                key={g.fixture.id}
                g={g}
                back={back}
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
