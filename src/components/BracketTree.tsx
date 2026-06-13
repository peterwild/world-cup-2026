// ─────────────────────────────────────────────────────────────────────────────
// The real knockout bracket, drawn as a tree with connector lines. Each slot
// fills in from the live feed as the Round of 32 is set and games are decided;
// teams the player backed to reach a round are highlighted, the advancing side
// is bolded, the eliminated side dimmed. Until the first knockout fixture exists
// (group stage still running) it shows a dated placeholder instead of an empty
// skeleton. The whole tree is one scrollable canvas — on a phone you pan it.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import {
  KO_TEMPLATE,
  TEMPLATE_BY_MATCH,
  R32_LEAF_ORDER,
  childMatches,
  FINAL_MATCH,
} from "@/lib/knockoutTemplate";
import type { AssembledBracket, BracketSlot } from "@/lib/knockoutBracket";
import { Flag } from "@/components/Flag";

const ROUND_COL: Record<string, number> = { R32: 0, R16: 1, QF: 2, SF: 3, FINAL: 4 };
const ROUND_LABELS = ["Round of 32", "Round of 16", "Quarterfinals", "Semifinals", "Final", "Champion"];

// Canvas geometry (px). The bracket is bigger than a phone screen by design —
// it lives in a scroll container.
const ROW_H = 62; // vertical space per R32 leaf
const CARD_W = 150;
const CARD_H = 46;
const COL_W = 174; // card + horizontal gap for connectors
const PAD_Y = 28;
const PAD_X = 12;

/** Vertical center (in R32-row units) of every match, parents at the midpoint of
 *  their two children. Static — derived once from the template. */
function rowCenters(): Record<number, number> {
  const y: Record<number, number> = {};
  R32_LEAF_ORDER.forEach((match, i) => (y[match] = i + 0.5));
  // Parents have higher match numbers than their children, so ascending order
  // guarantees children are computed first.
  for (const tm of [...KO_TEMPLATE].sort((a, b) => a.match - b.match)) {
    if (tm.round === "R32") continue;
    const kids = childMatches(tm.match);
    y[tm.match] = (y[kids[0]] + y[kids[1]]) / 2;
  }
  return y;
}

export function BracketTree({
  bracket,
  firstKickoffISO,
}: {
  bracket: AssembledBracket;
  firstKickoffISO: string | null;
}) {
  const centers = useMemo(() => rowCenters(), []);

  if (!bracket.hasFixtures) {
    return <Placeholder firstKickoffISO={firstKickoffISO} />;
  }

  const colX = (col: number) => PAD_X + col * COL_W;
  const cardTop = (match: number) => PAD_Y + centers[match] * ROW_H - CARD_H / 2;
  const cardMidY = (match: number) => PAD_Y + centers[match] * ROW_H;

  const width = colX(5) + CARD_W + PAD_X;
  const height = PAD_Y * 2 + R32_LEAF_ORDER.length * ROW_H;

  const finalY = cardMidY(FINAL_MATCH);

  return (
    <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: "70vh" }}>
      <div className="relative" style={{ width, height }}>
        {/* Round headers */}
        {ROUND_LABELS.map((label, col) => (
          <div
            key={label}
            className="absolute eyebrow text-muted-foreground"
            style={{ left: colX(col), top: 6, width: CARD_W }}
          >
            {label}
          </div>
        ))}

        {/* Connector lines (behind the cards) */}
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
          {KO_TEMPLATE.filter((tm) => tm.round !== "R32").flatMap((tm) => {
            const kids = childMatches(tm.match);
            const parentX = colX(ROUND_COL[tm.round]);
            const py = cardMidY(tm.match);
            return kids.map((kid) => {
              const childRight = colX(ROUND_COL[TEMPLATE_BY_MATCH[kid].round]) + CARD_W;
              const cy = cardMidY(kid);
              const midX = (childRight + parentX) / 2;
              return (
                <path
                  key={`${tm.match}-${kid}`}
                  d={`M ${childRight} ${cy} H ${midX} V ${py} H ${parentX}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={1.5}
                />
              );
            });
          })}
          {/* Final → Champion connector */}
          <path
            d={`M ${colX(4) + CARD_W} ${finalY} H ${colX(5)}`}
            fill="none"
            stroke="var(--border)"
            strokeWidth={1.5}
          />
        </svg>

        {/* Match cards */}
        {KO_TEMPLATE.map((tm) => {
          const node = bracket.nodes[tm.match];
          return (
            <div
              key={tm.match}
              className="absolute card-surface rounded-lg border border-border overflow-hidden"
              style={{ left: colX(ROUND_COL[tm.round]), top: cardTop(tm.match), width: CARD_W, height: CARD_H }}
            >
              <SlotRow slot={node.home} decided={isDecided(node.home, node.away)} />
              <div className="border-t border-border" />
              <SlotRow slot={node.away} decided={isDecided(node.home, node.away)} />
            </div>
          );
        })}

        {/* Champion box */}
        <div
          className="absolute rounded-lg border flex items-center px-2"
          style={{
            left: colX(5),
            top: finalY - CARD_H / 2,
            width: CARD_W,
            height: CARD_H,
            background: "var(--gold-soft)",
            borderColor: "var(--gold)",
          }}
        >
          {bracket.champion.teamId ? (
            <ChampionLabel teamId={bracket.champion.teamId} picked={bracket.champion.picked} />
          ) : (
            <span className="text-xs text-muted-foreground">🏆 TBD</span>
          )}
        </div>
      </div>
    </div>
  );
}

function isDecided(home: BracketSlot, away: BracketSlot): boolean {
  return home.advanced || away.advanced;
}

function SlotRow({ slot, decided }: { slot: BracketSlot; decided: boolean }) {
  const team = slot.teamId ? TEAMS_BY_ID[slot.teamId] : null;
  const out = decided && !slot.advanced; // eliminated here
  return (
    <div
      className="flex items-center gap-1.5 px-1.5 text-xs"
      style={{
        height: CARD_H / 2,
        background: slot.picked ? "var(--pitch-soft)" : undefined,
        opacity: out ? 0.4 : 1,
        fontWeight: slot.advanced ? 700 : 500,
      }}
    >
      {team ? (
        <>
          <Flag code={team.flag} sm />
          <span className="flex-1 truncate" style={out ? { textDecoration: "line-through" } : undefined}>
            {team.name}
          </span>
          {slot.picked && <span style={{ color: "var(--pitch)" }} title="you backed this team">✓</span>}
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

function ChampionLabel({ teamId, picked }: { teamId: string; picked: boolean }) {
  const team = TEAMS_BY_ID[teamId];
  if (!team) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm font-bold" style={{ color: "var(--gold)" }}>
      🏆 <Flag code={team.flag} sm /> {team.name}
      {picked && <span title="your pick">✓</span>}
    </span>
  );
}

function Placeholder({ firstKickoffISO }: { firstKickoffISO: string | null }) {
  // Format in the viewer's own timezone so the date is always right for them.
  const when = firstKickoffISO
    ? new Date(firstKickoffISO).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : null;
  return (
    <div className="card-surface rounded-xl border border-border p-6 text-center">
      <div className="text-2xl mb-2">🏆</div>
      <div className="font-semibold text-sm">The knockout bracket fills in here</div>
      <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto">
        Matchups and winners appear as the Round of 32 is set
        {when ? ` — first kickoff ${when}.` : " once the group stage ends."} Your picks light up as your
        teams advance.
      </p>
    </div>
  );
}
