import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionPlayerId } from "@/lib/session";
import { getGroupName } from "@/lib/repo";
import { computeLeaderboard, formatUsd } from "@/lib/standings";
import { PAYOUT_SPLIT, computePayouts } from "@/lib/tournament";
import { TEAMS_BY_ID } from "@/lib/teams";
import { Flag } from "@/components/Flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const meId = await getSessionPlayerId();
  if (!meId) redirect("/");

  const board = computeLeaderboard();
  const groupName = getGroupName();
  const champion = board.championId ? TEAMS_BY_ID[board.championId] : null;
  const payouts = computePayouts(board.potCents);
  const placeLabels = ["1st", "2nd", "3rd"];

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <header className="pt-5 pb-3 flex items-center justify-between pr-12">
        <span className="eyebrow">{groupName} · Leaderboard</span>
        <div className="flex items-center gap-3">
          <Link href="/picks" className="text-xs text-muted-foreground underline whitespace-nowrap">
            my picks
          </Link>
          <Link href="/" className="text-xs text-muted-foreground underline whitespace-nowrap">
            ← bracket
          </Link>
        </div>
      </header>

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
            <div>{board.paidCount} paid</div>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="eyebrow mb-2">
            {board.hasResults ? "Current payouts" : "Projected payouts"}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {payouts.map((cents, i) => (
              <div
                key={i}
                className="rounded-lg border border-border p-2 text-center"
                style={i === 0 ? { background: "var(--gold-soft)", borderColor: "var(--gold)" } : undefined}
              >
                <div className="eyebrow" style={i === 0 ? { color: "var(--gold)" } : undefined}>
                  {placeLabels[i]} · {Math.round(PAYOUT_SPLIT[i] * 100)}%
                </div>
                <div className="text-lg font-bold tabular-nums">{formatUsd(cents)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Champion + spirit callouts */}
      {champion && (
        <section
          className="mt-3 rounded-xl p-3 border flex items-center gap-3"
          style={{ background: "var(--gold-soft)", borderColor: "var(--gold)" }}
        >
          <Flag code={champion.flag} lg />
          <div>
            <div className="eyebrow" style={{ color: "var(--gold)" }}>
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
        {board.standings.map((s) => {
          const isMe = s.player.id === meId;
          const showPayout = board.hasResults && s.payoutCents > 0;
          return (
            <div
              key={s.player.id}
              className="flex items-center gap-3 rounded-xl px-3 py-3 border"
              style={{
                background: isMe ? "var(--pitch-soft)" : "var(--card)",
                borderColor: isMe ? "var(--pitch)" : "var(--border)",
              }}
            >
              <span className="w-6 text-center font-bold tabular-nums text-muted-foreground">
                {s.rank}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm flex items-center gap-1.5">
                  <span className="truncate">{s.player.name}</span>
                  {isMe && <span className="eyebrow">you</span>}
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
