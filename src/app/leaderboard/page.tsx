import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionPlayerId } from "@/lib/session";
import { getGroupName } from "@/lib/repo";
import { isLocked, kvGet, KV } from "@/lib/db";
import { computeLeaderboard, formatUsd } from "@/lib/standings";
import { PAYOUT_SPLIT, computePayouts } from "@/lib/tournament";
import { TEAMS_BY_ID } from "@/lib/teams";
import { Flag } from "@/components/Flag";
import { TopNav } from "@/components/TopNav";
import { Countdown } from "@/components/Countdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const meId = await getSessionPlayerId();
  if (!meId) redirect("/");

  const board = computeLeaderboard();
  const groupName = getGroupName();
  const locked = isLocked();
  const lockAt = kvGet<string | null>(KV.lockAt, null);
  const hasAiAssisted = board.standings.some((s) => s.aiAssisted);
  const champion = board.championId ? TEAMS_BY_ID[board.championId] : null;
  const payouts = computePayouts(board.potCents);
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

      {!board.hasResults && (
        <p className="mt-4 text-sm text-muted-foreground text-center">
          The tournament kicks off June 11. Standings and payouts update as games
          are played.
        </p>
      )}

      {/* Standings */}
      <div className="mt-4 space-y-2">
        {board.standings.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No brackets yet.
          </p>
        )}
        {!locked && board.standings.length > 0 && (
          <div className="text-center pb-1 space-y-0.5">
            {lockAt && (
              <p className="text-xs font-medium">
                🔒 Brackets unlock in{" "}
                <span style={{ color: "var(--pitch)" }}>
                  <Countdown target={lockAt} />
                </span>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {lockAt
                ? "Then tap anyone to see their full bracket."
                : "🔒 After kickoff, tap anyone to see their full bracket."}
            </p>
          </div>
        )}
        {hasAiAssisted && (
          <p className="text-xs text-muted-foreground text-center pb-1">
            ✨ = built with AI
          </p>
        )}
        {board.standings.map((s) => {
          const isMe = s.player.id === meId;
          const showPayout = board.hasResults && s.payoutCents > 0;
          const rowClass = "flex items-center gap-3 rounded-xl px-3 py-3 border";
          const rowStyle = {
            background: isMe ? "var(--pitch-soft)" : "var(--card)",
            borderColor: isMe ? "var(--pitch)" : "var(--border)",
          };
          const inner = (
            <>
              <span className="w-6 text-center font-bold tabular-nums text-muted-foreground">
                {s.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <span className="truncate">{s.player.name}</span>
                  {isMe && <span className="eyebrow">you</span>}
                  {s.aiAssisted && <span title="AI Assisted">✨</span>}
                  {s.spiritChampion && <span title="Spirit Champion">🏆</span>}
                  {s.score.correctChampion && (
                    <span title="Called the champion">👑</span>
                  )}
                </div>
                {board.hasResults && (
                  <div className="text-xs text-muted-foreground">
                    {s.score.groupPoints} group · {s.score.knockoutPoints} knockout
                    {s.tiebreak !== null && ` · TB ${s.tiebreak}`}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-bold tabular-nums">{s.score.total}</div>
                {showPayout ? (
                  <div className="text-xs" style={{ color: "var(--pitch)" }}>
                    {formatUsd(s.payoutCents)}
                  </div>
                ) : (
                  <div className="eyebrow">pts</div>
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
