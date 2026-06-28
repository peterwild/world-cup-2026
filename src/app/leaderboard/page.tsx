import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionPlayerId } from "@/lib/session";
import { getDraft, getGroupName, getResults } from "@/lib/repo";
import { backingDepth } from "@/lib/bracketState";
import { isLocked, kvGet, KV } from "@/lib/db";
import { computeLeaderboard, formatUsd } from "@/lib/standings";
import { PAYOUT_SPLIT, computePayouts } from "@/lib/tournament";
import { currentRooting, getOdds } from "@/lib/odds";
import { getLiveView } from "@/lib/liveScores";
import { isInPlay } from "@/lib/footballData";
import { pointsRank, spiritPulse } from "@/lib/analytics";
import { TEAMS_BY_ID } from "@/lib/teams";
import { Flag } from "@/components/Flag";
import { TopNav } from "@/components/TopNav";
import { Countdown } from "@/components/Countdown";
import { OddsCard, pct } from "@/components/OddsCard";
import { RootingCard } from "@/components/RootingCard";
import { LiveStrip } from "@/components/LiveStrip";
import { GoldenBootCard } from "@/components/GoldenBootCard";
import { pulseEmoji, pulseSentence } from "@/components/SpiritPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const meId = await getSessionPlayerId();
  if (!meId) redirect("/");

  const groupName = getGroupName();
  const locked = isLocked();
  const lockAt = kvGet<string | null>(KV.lockAt, null);

  // Cached Monte Carlo odds (recomputed by the score cron). Post-lock only,
  // and gracefully absent until the first recompute lands. Fetched before the
  // leaderboard so win odds can break ties in the ranking (standings.ts).
  const odds = locked ? getOdds() : null;
  const oddsById = new Map((odds?.entries ?? []).map((e) => [e.id, e]));

  const board = computeLeaderboard(
    new Map((odds?.entries ?? []).map((e) => [e.id, e.winProb])),
  );
  const hasAiAssisted = board.standings.some((s) => s.aiAssisted);
  const myStanding = board.standings.find((s) => s.player.id === meId);
  const myIncomplete = !locked && !!myStanding && !myStanding.complete;
  const champion = board.championId ? TEAMS_BY_ID[board.championId] : null;
  const payouts = computePayouts(board.potCents);
  const results = odds ? getResults() : null;
  const myOdds = oddsById.get(meId);
  const rooting = currentRooting(odds?.rooting ?? []);
  // Live games belong to the live strip (with their score + odds arrow), so
  // keep them out of the upcoming-games "who to root for" card — no double-show.
  //
  // The rooting snapshot's `status` is stale: it's whatever the cron last saw,
  // so a game that kicked off after the snapshot still reads "TIMED" here. The
  // authoritative "is it live right now" signal is the live feed, so we dedupe
  // against its actual in-play pairs (cached + self-throttling — no extra call).
  const liveView = await getLiveView();
  const livePairs = new Set(liveView.live.map((g) => `${g.home}-${g.away}`));
  // Pending = a result the odds haven't folded in yet. A live game's final
  // hasn't landed; a game whose kickoff just passed (awaitingKickoff) is the
  // feed catching up. Either way the odds correctly lag — say so instead of
  // showing silent stale numbers right when people check after a game.
  const oddsPending = odds
    ? liveView.live.length > 0
      ? "Update pending"
      : liveView.awaitingKickoff
        ? "Update pending"
        : null
    : null;
  const isLiveNow = (r: { fixture: { home: string; away: string; status: string } }) =>
    isInPlay(r.fixture.status) || livePairs.has(`${r.fixture.home}-${r.fixture.away}`);
  const rootingUpcoming = {
    games: rooting.games.filter((r) => !isLiveNow(r)),
    laterGames: rooting.laterGames.filter((r) => !isLiveNow(r)),
  };

  // How deeply my bracket backs each team — the basis for "who to root for"
  // everywhere (live strip + upcoming card). Always available (no odds window),
  // and never contradicts my picks. The live strip settles finished games too.
  const myBackDepth = backingDepth(getDraft(meId).draft);

  const placeLabels = ["1st", "2nd", "3rd"];
  const placeColors = [
    { soft: "var(--podium-gold-soft)", line: "var(--podium-gold)" },
    { soft: "var(--silver-soft)", line: "var(--silver)" },
    { soft: "var(--bronze-soft)", line: "var(--bronze)" },
  ];

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <TopNav current="leaderboard" context={`${groupName} · Leaderboard`} />

      {/* Pot summary */}
      <section className="card-surface rounded-xl p-4 border border-border">
        <div className="flex items-end justify-between">
          <div>
            <div className="eyebrow">Total pot</div>
            <div className="text-3xl font-extrabold tabular-nums">
              {formatUsd(board.potCents)}
            </div>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div>
              {board.entrants} {board.entrants === 1 ? "entry" : "entries"}
            </div>
            <div>{formatUsd(board.buyInCents)} buy-in</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="eyebrow mb-2">Current payouts</div>
          <div className="grid grid-cols-3 gap-2">
            {payouts.map((cents, i) => {
              const c = placeColors[i] ?? placeColors[0];
              return (
                <div
                  key={i}
                  className="rounded-lg border p-2 text-center"
                  style={{ background: c.soft, borderColor: c.line }}
                >
                  <div className="eyebrow" style={{ color: c.line }}>
                    {placeLabels[i]} · {Math.round(PAYOUT_SPLIT[i] * 100)}%
                  </div>
                  <div className="text-lg font-bold tabular-nums">{formatUsd(cents)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Golden Boot side bet — opt-in prompt / picker / status (client, self-fetches) */}
      <GoldenBootCard />

      {/* Champion + spirit callouts */}
      {champion && (
        <section
          className="mt-3 rounded-xl p-3 border flex items-center gap-3"
          style={{ background: "var(--podium-gold-soft)", borderColor: "var(--podium-gold)" }}
        >
          <Flag code={champion.flag} lg />
          <div>
            <div className="eyebrow" style={{ color: "var(--podium-gold)" }}>
              World Champion
            </div>
            <div className="font-bold">{champion.name}</div>
          </div>
        </section>
      )}
      {board.spiritChampions.length > 0 && (
        <section className="mt-3 rounded-xl p-3 border border-border card-surface">
          <div className="eyebrow mb-1">🏆 Spirit Champion{board.spiritChampions.length > 1 ? "s" : ""}</div>
          <div className="text-sm">
            {board.spiritChampions.map((p) => p.name).join(", ")} — their spirit team won
            it all. Eternal bragging rights.
          </div>
        </section>
      )}

      {/* Your odds — Monte Carlo, refreshed as results land. The delta line +
          freshness explain what moved you since the last recompute. */}
      {odds && myOdds && (
        <OddsCard
          entry={myOdds}
          sims={odds.sims}
          delta={odds.deltas?.[meId]}
          rank={pointsRank(odds.entries, meId)}
          computedAt={odds.computedAt}
          pending={oddsPending}
        />
      )}

      {/* Live & today's scores — people come here for the games too. Renders
          nothing when nothing's live or finished today. */}
      <LiveStrip
        back={myBackDepth}
        spiritTeamId={myStanding?.spiritTeamId ?? null}
      />

      {/* Who to root for — UPCOMING games only (live ones are in the strip
          above). The team your own bracket carries further; read off `back`. */}
      {odds && myOdds && rootingUpcoming.games.length > 0 && (
        <RootingCard
          games={rootingUpcoming.games}
          laterGames={rootingUpcoming.laterGames}
          back={myBackDepth}
          spiritTeamId={myStanding?.spiritTeamId ?? null}
        />
      )}

      {!board.hasResults && (
        <p className="mt-4 text-sm text-muted-foreground text-center">
          The tournament kicks off June 11. Standings and payouts update as games
          are played.
        </p>
      )}

      {/* Standings */}
      <div className="mt-4 space-y-2">
        {myIncomplete && (
          <Link
            href="/?step=review"
            className="block rounded-xl px-4 py-2.5 text-xs text-center font-medium active:scale-[0.99] transition"
            style={{ background: "rgba(239, 68, 68, 0.12)", color: "var(--destructive)" }}
          >
            ⚠ Your bracket is incomplete — tap to finish before kickoff, or it won&apos;t score.
          </Link>
        )}
        {board.standings.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No brackets yet.
          </p>
        )}
        {!locked && board.standings.length > 0 && (
          <div className="text-center pb-1 space-y-0.5">
            {lockAt && (
              <p className="text-xs font-medium">
                🔒 Everyone&apos;s bracket becomes viewable in{" "}
                <span style={{ color: "var(--pitch)" }}>
                  <Countdown target={lockAt} />
                </span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {lockAt
                ? "Tap anyone to see their full bracket."
                : "🔒 After kickoff, tap anyone to see their full bracket."}
            </p>
          </div>
        )}
        {hasAiAssisted && (
          <p className="text-xs text-muted-foreground text-center pb-1">
            ✨ = AI Assisted
          </p>
        )}
        {odds && (
          <p className="text-xs text-muted-foreground text-center pb-1">
            Spirit team: 💗 favored to advance · 💓 sweating it · 💔 out
          </p>
        )}
        {board.standings.map((s) => {
          const isMe = s.player.id === meId;
          const showPayout = board.hasResults && s.payoutCents > 0;
          const rowOdds = oddsById.get(s.player.id);
          const rowDelta = odds?.deltas?.[s.player.id];
          const pulse =
            results && odds && s.spiritTeamId && !s.spiritChampion
              ? spiritPulse(s.spiritTeamId, odds.teams, results)
              : null;
          const spiritTeam = s.spiritTeamId ? TEAMS_BY_ID[s.spiritTeamId] : null;
          const spiritName = spiritTeam?.name ?? s.spiritTeamId ?? "";
          // Champion pick is a bracket secret until lock — only surface it once
          // everyone's brackets are viewable.
          const championTeam =
            locked && s.championPick ? TEAMS_BY_ID[s.championPick] : null;
          const rowClass = "flex items-center gap-3 rounded-xl px-3 py-3 border";
          const rowStyle = {
            background: isMe ? "var(--pitch-soft)" : "var(--card)",
            borderColor: isMe ? "var(--pitch)" : "var(--border)",
          };
          const inner = (
            <>
              <div className="w-6 shrink-0 flex flex-col items-center leading-none">
                <span className="font-bold tabular-nums text-muted-foreground">
                  {s.rank}
                </span>
                {rowDelta?.rankDelta ? (
                  <span
                    className="text-[10px] font-semibold tabular-nums mt-0.5"
                    style={{
                      color: rowDelta.rankDelta > 0 ? "var(--pitch)" : "var(--destructive)",
                    }}
                    title={`${rowDelta.rankDelta > 0 ? "Up" : "Down"} ${Math.abs(
                      rowDelta.rankDelta,
                    )} since the last update`}
                  >
                    {rowDelta.rankDelta > 0 ? "▲" : "▼"}
                    {Math.abs(rowDelta.rankDelta)}
                  </span>
                ) : null}
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <span className="truncate">{s.player.name}</span>
                  {isMe && <span className="eyebrow">you</span>}
                  {s.aiAssisted && <span title="AI Assisted">✨</span>}
                  {s.spiritChampion && <span title="Spirit Champion">🏆</span>}
                  {s.score.correctChampion && (
                    <span title="Called the champion">👑</span>
                  )}
                </div>
                {championTeam && (
                  <div
                    className="text-xs text-muted-foreground flex items-center gap-1"
                    title={`Picked ${championTeam.name} to win the cup`}
                  >
                    <span>Champion:</span>
                    <Flag code={championTeam.flag} />
                    <span className="truncate">{championTeam.name}</span>
                  </div>
                )}
                {board.hasResults && (
                  <div className="text-xs text-muted-foreground">
                    {s.score.groupPoints} group · {s.score.knockoutPoints} knockout
                    {s.tiebreak !== null && ` · TB ${s.tiebreak}`}
                  </div>
                )}
                {/* Spirit pulse on its own labeled line — next to the name it
                    read like a badge about the player, not their team. */}
                {pulse && (
                  <div
                    className="text-xs text-muted-foreground flex items-center gap-1"
                    title={`Spirit team ${pulseSentence(pulse, spiritName)}`}
                  >
                    <span>Spirit: {pulseEmoji(pulse)}</span>
                    {spiritTeam && <Flag code={spiritTeam.flag} sm />}
                    <span className="truncate">{spiritName}</span>
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-bold tabular-nums">{s.score.total}</div>
                {showPayout && (
                  <div className="text-xs" style={{ color: "var(--pitch)" }}>
                    {formatUsd(s.payoutCents)}
                  </div>
                )}
                {rowOdds ? (
                  <div className="text-xs text-muted-foreground tabular-nums flex items-center justify-end gap-0.5">
                    {rowDelta && Math.abs(rowDelta.winProbDelta) >= 0.005 && (
                      <span
                        aria-hidden
                        title={
                          rowDelta.drivers.length > 0
                            ? rowDelta.drivers.join(", ")
                            : "the field shifted"
                        }
                        style={{
                          color: rowDelta.winProbDelta > 0 ? "var(--pitch)" : "var(--destructive)",
                        }}
                      >
                        {rowDelta.winProbDelta > 0 ? "↑" : "↓"}
                      </span>
                    )}
                    {pct(rowOdds.winProb)} win
                  </div>
                ) : (
                  !showPayout && <div className="eyebrow">pts</div>
                )}
              </div>
              {/* Whole row is the link post-lock; a chevron is the only cue
                  (no caption + no hover on mobile). Pre-lock the row is dimmed
                  + non-interactive so it reads as "not active yet". */}
              {locked && (
                <span
                  className="shrink-0 text-lg leading-none text-muted-foreground"
                  aria-hidden
                >
                  ›
                </span>
              )}
            </>
          );
          return locked ? (
            <Link
              key={s.player.id}
              href={isMe ? "/picks" : `/picks/${s.player.id}`}
              className={`${rowClass} transition active:scale-[0.99]`}
              style={rowStyle}
            >
              {inner}
            </Link>
          ) : (
            <div
              key={s.player.id}
              className={`${rowClass} opacity-60 cursor-not-allowed`}
              style={rowStyle}
            >
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}
