// ─────────────────────────────────────────────────────────────────────────────
// Bracket view of a player's picks on the real tournament. Two stacked parts:
//   • the live knockout bracket tree (BracketTree) — real matchups + connector
//     lines, filling in as the Round of 32 is set, your backed teams highlighted;
//   • live group tables below, computed from the games played so far, with your
//     predicted 1st/2nd marked.
// The per-round pick sets live in the List view; here it's the real bracket.
// ─────────────────────────────────────────────────────────────────────────────

import { GROUP_IDS, TEAMS_BY_ID, type GroupId } from "@/lib/teams";
import type { DraftBracket } from "@/lib/bracketState";
import type { Results } from "@/lib/scoring";
import { groupAdvanceStatus, groupWinnerHit, type PickStatus } from "@/lib/pickStatus";
import type { GroupStanding } from "@/lib/groupTables";
import type { AssembledBracket } from "@/lib/knockoutBracket";
import { BracketTree } from "@/components/BracketTree";
import { Flag } from "@/components/Flag";

export function BracketCanvas({
  bracket,
  firstKickoffISO,
  draft,
  results,
  showStatus,
  groupTables,
  possessive = "your",
}: {
  bracket: AssembledBracket;
  firstKickoffISO: string | null;
  draft: DraftBracket;
  results: Results;
  showStatus: boolean;
  groupTables: Record<GroupId, GroupStanding[]>;
  /** Inline possessive — "your" or "Tim's" when viewing someone else. */
  possessive?: string;
}) {
  return (
    <div className="mt-4 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow">Knockout bracket</span>
          <span className="text-[10px] text-muted-foreground">
            <span style={{ color: "var(--pitch)" }}>✓</span> {possessive} pick · scroll to pan
          </span>
        </div>
        <BracketTree bracket={bracket} firstKickoffISO={firstKickoffISO} possessive={possessive} />
      </div>

      {/* Group stage — live tables from the games played so far. */}
      <div>
        <div className="eyebrow">Group stage · live tables</div>
        <p className="text-[10px] text-muted-foreground mt-0.5">
          Team standings, not {possessive} pool score · P played · GD goal difference · Pts group points (3 win / 1 draw)
        </p>
        <p className="text-[10px] text-muted-foreground mb-2 mt-0.5 flex items-center gap-1 flex-wrap">
          <span
            className="inline-block w-3 h-3 rounded-sm align-middle"
            style={{ background: "var(--pitch-soft)" }}
          />
          = {possessive} picks to advance · <span style={{ color: "var(--pitch)" }}>✓</span> advanced ·{" "}
          <span style={{ color: "var(--destructive)" }}>✗</span> out · 👑 called the group winner
        </p>
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

function StatusMark({ status }: { status?: PickStatus }) {
  if (status === "correct")
    return <span style={{ color: "var(--pitch)" }} title="correct">✓</span>;
  if (status === "missed")
    return <span style={{ color: "var(--destructive)" }} title="out">✗</span>;
  return null;
}
