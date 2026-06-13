"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Your predicted path, as a champion spine. The left rail is one team's run down
// the rounds (the champion by default); the right of each row is the rest of the
// field you backed to reach that round. Tap any team to re-root the spine on it
// and trace how far you had it going. Built straight from the pick sets — no
// matchup inference — so it's honest about what you actually predicted. ✓/✗
// overlays land as results come in, mirroring the List view's scoring.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import { r32Field, type DraftBracket } from "@/lib/bracketState";
import type { Results } from "@/lib/scoring";
import { knockoutPickStatus, r32PickStatus, type PickStatus } from "@/lib/pickStatus";
import { ROUND_POINTS, type KnockoutRound } from "@/lib/tournament";
import { Flag } from "@/components/Flag";

const SPINE_ROUNDS: KnockoutRound[] = ["CHAMPION", "FINAL", "SF", "QF", "R16", "R32"];
const ROUND_LABEL: Record<KnockoutRound, string> = {
  CHAMPION: "Champion",
  FINAL: "Final",
  SF: "Semifinals",
  QF: "Quarterfinals",
  R16: "Round of 16",
  R32: "Round of 32",
};

export function PredictedSpine({
  draft,
  results,
  showStatus,
}: {
  draft: DraftBracket;
  results: Results;
  showStatus: boolean;
}) {
  const levels = useMemo(() => {
    const teamsFor = (round: KnockoutRound): string[] =>
      round === "R32" ? r32Field(draft) : draft.rounds[round] ?? [];
    return SPINE_ROUNDS.map((round) => ({ round, teams: teamsFor(round) }));
  }, [draft]);

  const champion = draft.rounds.CHAMPION?.[0] ?? null;
  const [traced, setTraced] = useState<string | null>(champion);
  const focus = traced ?? champion;

  const statusOf = (round: KnockoutRound, id: string): PickStatus | undefined =>
    showStatus ? (round === "R32" ? r32PickStatus(results, id) : knockoutPickStatus(results, round, id)) : undefined;

  const focusTeam = focus ? TEAMS_BY_ID[focus] : null;
  const empty = levels.every((l) => l.teams.length === 0);

  if (empty) {
    return <p className="mt-4 text-sm text-muted-foreground text-center">No picks to chart yet.</p>;
  }

  return (
    <div className="mt-4">
      <p className="text-xs text-muted-foreground mb-3 text-center">
        {focusTeam ? (
          <>
            Tracing <span className="font-semibold text-foreground">{focusTeam.name}</span> · tap any team to trace its path
          </>
        ) : (
          "Tap any team to trace its predicted path"
        )}
      </p>

      <div className="space-y-2">
        {levels.map(({ round, teams }) => {
          const onSpine = !!focus && teams.includes(focus);
          const others = teams.filter((t) => t !== focus);
          return (
            <div key={round} className="flex items-stretch gap-2">
              {/* Spine rail — the focused team's node at this round (or a gap). */}
              <div className="w-[124px] shrink-0">
                {onSpine && focus ? (
                  <SpineNode
                    teamId={focus}
                    label={ROUND_LABEL[round]}
                    status={statusOf(round, focus)}
                  />
                ) : (
                  <div className="h-full min-h-[2.75rem] rounded-lg border border-dashed border-border opacity-40" />
                )}
              </div>

              {/* The rest of the field you had reaching this round. */}
              <div className="flex-1 min-w-0">
                <div className="eyebrow text-[10px] mb-1">
                  {ROUND_LABEL[round]} · {teams.length} · {ROUND_POINTS[round]}pt
                </div>
                {others.length === 0 ? (
                  <span className="text-xs text-muted-foreground">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {others.map((id) => (
                      <Chip key={id} teamId={id} status={statusOf(round, id)} onTap={() => setTraced(id)} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The highlighted focused-team node on the left rail. */
function SpineNode({
  teamId,
  label,
  status,
}: {
  teamId: string;
  label: string;
  status?: PickStatus;
}) {
  const team = TEAMS_BY_ID[teamId];
  if (!team) return null;
  const champion = label === "Champion";
  const missed = status === "missed";
  return (
    <div
      className="h-full min-h-[2.75rem] rounded-lg px-2 py-1.5 flex flex-col justify-center border-l-[3px]"
      style={{
        background: champion ? "var(--gold-soft)" : "var(--pitch-soft)",
        borderColor: champion ? "var(--gold)" : "var(--pitch)",
        opacity: missed ? 0.5 : 1,
      }}
    >
      <div className="flex items-center gap-1.5">
        {champion && <span aria-hidden>🏆</span>}
        <Flag code={team.flag} sm />
        <span
          className="text-sm font-bold truncate"
          style={missed ? { textDecoration: "line-through" } : undefined}
        >
          {team.name}
        </span>
        <StatusMark status={status} />
      </div>
    </div>
  );
}

/** A team in the field at a round — tap to re-root the spine on it. */
function Chip({
  teamId,
  status,
  onTap,
}: {
  teamId: string;
  status?: PickStatus;
  onTap: () => void;
}) {
  const team = TEAMS_BY_ID[teamId];
  if (!team) return null;
  const missed = status === "missed";
  return (
    <button
      onClick={onTap}
      className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-1 text-xs active:scale-[0.97] transition"
      style={missed ? { opacity: 0.45 } : undefined}
    >
      <Flag code={team.flag} sm />
      <span className="truncate max-w-[5.5rem]" style={missed ? { textDecoration: "line-through" } : undefined}>
        {team.name}
      </span>
      <StatusMark status={status} />
    </button>
  );
}

function StatusMark({ status }: { status?: PickStatus }) {
  if (status === "correct")
    return <span style={{ color: "var(--pitch)" }} title="correct">✓</span>;
  if (status === "missed")
    return <span style={{ color: "var(--destructive)" }} title="out">✗</span>;
  return null;
}
