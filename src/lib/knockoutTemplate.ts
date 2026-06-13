// ─────────────────────────────────────────────────────────────────────────────
// The fixed 2026 World Cup knockout bracket skeleton (FIFA match numbers 73–104,
// minus the 3rd-place playoff #103). The live feed gives us each knockout game's
// teams + winner but NOT which game feeds which — that connectivity is here, so
// the bracket view can draw the tree and its connector lines even before teams
// are known.
//
// Source: official bracket structure, 2026 FIFA World Cup knockout stage.
// Each R32 slot is defined by group position; the third-place sides carry the
// candidate groups (which actual third-placer lands there is read from the feed,
// so we never need FIFA's 495-combination third-place table). R16+ slots are
// defined purely by which earlier match winners feed them.
// ─────────────────────────────────────────────────────────────────────────────

import type { GroupId } from "./teams";
import type { KnockoutRound } from "./tournament";

/** Where a bracket slot's occupant comes from. */
export type SlotSource =
  | { kind: "winner"; group: GroupId }
  | { kind: "runnerup"; group: GroupId }
  | { kind: "third"; groups: GroupId[] } // the 3rd-placer from one of these groups
  | { kind: "matchWinner"; match: number };

export interface TemplateMatch {
  /** FIFA match number — our stable slot id across the tree. */
  match: number;
  round: Exclude<KnockoutRound, "CHAMPION">; // a match belongs to R32…FINAL
  a: SlotSource;
  b: SlotSource;
}

const w = (group: GroupId): SlotSource => ({ kind: "winner", group });
const r = (group: GroupId): SlotSource => ({ kind: "runnerup", group });
const t = (...groups: GroupId[]): SlotSource => ({ kind: "third", groups });
const m = (match: number): SlotSource => ({ kind: "matchWinner", match });

/** All 31 knockout matches, keyed by FIFA match number (3rd-place playoff #103
 *  is intentionally omitted — our pool doesn't score it). */
export const KO_TEMPLATE: TemplateMatch[] = [
  // ── Round of 32 (73–88) ──
  { match: 73, round: "R32", a: r("A"), b: r("B") },
  { match: 74, round: "R32", a: w("E"), b: t("A", "B", "C", "D", "F") },
  { match: 75, round: "R32", a: w("F"), b: r("C") },
  { match: 76, round: "R32", a: w("C"), b: r("F") },
  { match: 77, round: "R32", a: w("I"), b: t("C", "D", "F", "G", "H") },
  { match: 78, round: "R32", a: r("E"), b: r("I") },
  { match: 79, round: "R32", a: w("A"), b: t("C", "E", "F", "H", "I") },
  { match: 80, round: "R32", a: w("L"), b: t("E", "H", "I", "J", "K") },
  { match: 81, round: "R32", a: w("D"), b: t("B", "E", "F", "I", "J") },
  { match: 82, round: "R32", a: w("G"), b: t("A", "E", "H", "I", "J") },
  { match: 83, round: "R32", a: r("K"), b: r("L") },
  { match: 84, round: "R32", a: w("H"), b: r("J") },
  { match: 85, round: "R32", a: w("B"), b: t("E", "F", "G", "I", "J") },
  { match: 86, round: "R32", a: w("J"), b: r("H") },
  { match: 87, round: "R32", a: w("K"), b: t("D", "E", "I", "J", "L") },
  { match: 88, round: "R32", a: r("D"), b: r("G") },

  // ── Round of 16 (89–96) ──
  { match: 89, round: "R16", a: m(74), b: m(77) },
  { match: 90, round: "R16", a: m(73), b: m(75) },
  { match: 91, round: "R16", a: m(76), b: m(78) },
  { match: 92, round: "R16", a: m(79), b: m(80) },
  { match: 93, round: "R16", a: m(83), b: m(84) },
  { match: 94, round: "R16", a: m(81), b: m(82) },
  { match: 95, round: "R16", a: m(86), b: m(88) },
  { match: 96, round: "R16", a: m(85), b: m(87) },

  // ── Quarterfinals (97–100) ──
  { match: 97, round: "QF", a: m(89), b: m(90) },
  { match: 98, round: "QF", a: m(93), b: m(94) },
  { match: 99, round: "QF", a: m(91), b: m(92) },
  { match: 100, round: "QF", a: m(95), b: m(96) },

  // ── Semifinals (101–102) ──
  { match: 101, round: "SF", a: m(97), b: m(98) },
  { match: 102, round: "SF", a: m(99), b: m(100) },

  // ── Final (104) ──
  { match: 104, round: "FINAL", a: m(101), b: m(102) },
];

export const TEMPLATE_BY_MATCH: Record<number, TemplateMatch> = Object.fromEntries(
  KO_TEMPLATE.map((tm) => [tm.match, tm]),
);

/** The final, whose winner is the champion. */
export const FINAL_MATCH = 104;

/** R32 match numbers in bracket order, top → bottom — derived by a depth-first
 *  walk down from the final so siblings stay adjacent. This is the vertical
 *  order the tree renders in. */
export const R32_LEAF_ORDER: number[] = (() => {
  const order: number[] = [];
  const walk = (match: number) => {
    const tm = TEMPLATE_BY_MATCH[match];
    if (!tm) return;
    for (const side of [tm.a, tm.b]) {
      if (side.kind === "matchWinner") walk(side.match);
      else {
        // leaf: this match is an R32 game (only reached once per leaf)
        if (!order.includes(match)) order.push(match);
      }
    }
  };
  walk(FINAL_MATCH);
  return order;
})();

/** The two child match numbers feeding a match, or [] for an R32 leaf. */
export function childMatches(match: number): number[] {
  const tm = TEMPLATE_BY_MATCH[match];
  if (!tm) return [];
  return [tm.a, tm.b].flatMap((s) => (s.kind === "matchWinner" ? [s.match] : []));
}
