// ─────────────────────────────────────────────────────────────────────────────
// Bracket view of a player's picks, overlaid on what's actually happened.
//
// Phase 1 = "live overlay": picks are stored as sets-per-round (not head-to-head
// matchups), so we render each round as a column of the teams this player backed
// to reach it, marked ✓ alive / ✗ out as results land — plus live group tables
// below. Orientation drives the shape: portrait stacks the rounds top→bottom
// (climbing to the champion); landscape lays them out as side-by-side columns,
// the wide bracket you've got the width for once you rotate. A reconstructed
// predicted-path tree is Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, TEAMS_BY_ID, type GroupId } from "@/lib/teams";
import { r32Field, type DraftBracket } from "@/lib/bracketState";
import type { Results } from "@/lib/scoring";
import {
  knockoutPickStatus,
  groupAdvanceStatus,
  groupWinnerHit,
  type PickStatus,
} from "@/lib/pickStatus";
import { KNOCKOUT_ROUNDS, ROUND_POINTS, type KnockoutRound } from "@/lib/tournament";
import type { GroupStanding } from "@/lib/groupTables";
import { Flag } from "@/components/Flag";

const ROUND_LABEL: Record<KnockoutRound, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarterfinals",
  SF: "Semifinals",
  FINAL: "Final",
  CHAMPION: "Champion",
};

// alive first, undecided next, busted last — so a column reads top-down as
// "who's still carrying my bracket".
const STATUS_RANK: Record<PickStatus, number> = { correct: 0, pending: 1, missed: 2 };

export function BracketCanvas({
  draft,
  results,
  showStatus,
  groupTables,
}: {
  draft: DraftBracket;
  results: Results;
  showStatus: boolean;
  groupTables: Record<GroupId, GroupStanding[]>;
}) {
  const teamsFor = (round: KnockoutRound): string[] =>
    round === "R32" ? r32Field(draft) : draft.rounds[round] ?? [];

  return (
    <div className="mt-4 space-y-6">
      {showStatus && <Legend />}

      {/* Knockout rounds. Portrait: a vertical climb R32 → 🏆. Landscape: the
          same columns side by side, horizontally scrollable. */}
      <div className="flex flex-col gap-3 landscape:flex-row landscape:gap-4 landscape:overflow-x-auto landscape:pb-2">
        {KNOCKOUT_ROUNDS.map((round) => (
          <RoundColumn
            key={round}
            round={round}
            teamIds={teamsFor(round)}
            results={results}
            showStatus={showStatus}
          />
        ))}
      </div>

      {/* Group stage — live tables from the games played so far. */}
      <div>
        <div className="eyebrow mb-2">Group stage · live tables</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 landscape:grid-cols-3 gap-3">
          {GROUP_IDS.map((g) => (
            <GroupCard
              key={g}
              group={g}
              standings={groupTables[g] ?? []}
              draft={draft}
              results={results}
              showStatus={showStatus}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Knockout round column ─────────────────────────────────────────────────────

function RoundColumn({
  round,
  teamIds,
  results,
  showStatus,
}: {
  round: KnockoutRound;
  teamIds: string[];
  results: Results;
  showStatus: boolean;
}) {
  const champion = round === "CHAMPION";
  const sorted = showStatus
    ? [...teamIds].sort(
        (a, b) =>
          STATUS_RANK[knockoutPickStatus(results, round, a)] -
            STATUS_RANK[knockoutPickStatus(results, round, b)] ||
          (TEAMS_BY_ID[a]?.name ?? a).localeCompare(TEAMS_BY_ID[b]?.name ?? b),
      )
    : teamIds;

  return (
    <section className="card-surface rounded-xl p-3 border border-border landscape:min-w-[180px] landscape:flex-shrink-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="eyebrow">{ROUND_LABEL[round]}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {teamIds.length ? `${teamIds.length} · ${ROUND_POINTS[round]}pt` : ""}
        </span>
      </div>
      {sorted.length === 0 ? (
        <Empty />
      ) : (
        <div className={champion ? "" : "flex flex-wrap gap-x-3 gap-y-1.5 landscape:flex-col"}>
          {sorted.map((id) => (
            <BracketTeam
              key={id}
              teamId={id}
              status={showStatus ? knockoutPickStatus(results, round, id) : undefined}
              big={champion}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BracketTeam({
  teamId,
  status,
  big,
}: {
  teamId: string;
  status?: PickStatus;
  big?: boolean;
}) {
  const t = TEAMS_BY_ID[teamId];
  if (!t) return null;
  const missed = status === "missed";
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${big ? "text-lg font-bold" : "text-sm font-medium"}`}
      style={missed ? { opacity: 0.45 } : undefined}
    >
      <Flag code={t.flag} lg={big} />
      <span style={missed ? { textDecoration: "line-through" } : undefined}>{t.name}</span>
      <StatusMark status={status} />
    </span>
  );
}

// ── Group stage card ──────────────────────────────────────────────────────────

function GroupCard({
  group,
  standings,
  draft,
  results,
  showStatus,
}: {
  group: GroupId;
  standings: GroupStanding[];
  draft: DraftBracket;
  results: Results;
  showStatus: boolean;
}) {
  const predicted = draft.groupOrder[group] ?? [];
  const myTop2 = new Set(predicted.slice(0, 2));
  const myWinner = predicted[0];

  return (
    <section className="card-surface rounded-xl p-3 border border-border">
      <div className="font-bold text-sm mb-2">Group {group}</div>
      <div className="space-y-1">
        {standings.map((row, i) => {
          const t = TEAMS_BY_ID[row.teamId];
          if (!t) return null;
          const mine = myTop2.has(row.teamId);
          // Once the group settles, mark whether my top-2 pick actually advanced.
          const status = showStatus && mine ? groupAdvanceStatus(results, group, row.teamId) : undefined;
          const winnerHit = showStatus && row.teamId === myWinner && groupWinnerHit(results, group, row.teamId);
          return (
            <div
              key={row.teamId}
              className="flex items-center gap-1.5 text-xs rounded px-1 py-0.5"
              style={mine ? { background: "var(--pitch-soft)" } : undefined}
            >
              <span className="w-3 text-[10px] text-muted-foreground tabular-nums">{i + 1}</span>
              <Flag code={t.flag} sm />
              <span className="flex-1 truncate" style={mine ? { fontWeight: 600 } : undefined}>
                {t.name}
              </span>
              {winnerHit && <span title="Called the group winner (+1)">👑</span>}
              <StatusMark status={status} />
              <span className="tabular-nums text-muted-foreground w-4 text-right">{row.played}</span>
              <span className="tabular-nums text-muted-foreground w-7 text-right">
                {row.gd > 0 ? `+${row.gd}` : row.gd}
              </span>
              <span className="tabular-nums font-semibold w-4 text-right">{row.points}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-end gap-3 text-[9px] text-muted-foreground tabular-nums pr-1">
        <span>P</span>
        <span>GD</span>
        <span>Pts</span>
      </div>
    </section>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function StatusMark({ status }: { status?: PickStatus }) {
  if (status === "correct")
    return <span style={{ color: "var(--pitch)" }} title="correct">✓</span>;
  if (status === "missed")
    return <span style={{ color: "var(--destructive)" }} title="out">✗</span>;
  return null;
}

function Legend() {
  return (
    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
      <span>
        <span style={{ color: "var(--pitch)" }}>✓</span> still in
      </span>
      <span>
        <span style={{ color: "var(--destructive)" }}>✗</span> out
      </span>
      <span>· pending</span>
    </div>
  );
}

function Empty() {
  return <span className="text-muted-foreground text-sm">—</span>;
}
