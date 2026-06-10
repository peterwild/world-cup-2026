import type { SpiritPulse } from "@/lib/analytics";
import type { KnockoutRound } from "@/lib/tournament";
import { pct } from "./OddsCard";

// Heartbreak-meter copy, shared by the leaderboard badges (emoji + tooltip)
// and the bracket pages (full line). Only 1 of 48 spirit teams survives —
// near-universal heartbreak is the feature.

/** The spirit team's next survival checkpoint, in plain words. */
const ROUND_LABEL: Record<KnockoutRound, string> = {
  R32: "the knockouts",
  R16: "the Round of 16",
  QF: "the quarterfinals",
  SF: "the semifinals",
  FINAL: "the final",
  CHAMPION: "the title",
};

export function pulseEmoji(p: SpiritPulse): string {
  if (p.state === "champion") return "🏆";
  if (p.state === "out") return "💔";
  return p.p >= 0.5 ? "💗" : "💓";
}

export function pulseSentence(p: SpiritPulse, teamName: string): string {
  if (p.state === "champion") return `${teamName} won it all — Spirit Champion`;
  if (p.state === "out") return `${teamName} are out — heartbroken`;
  return `${teamName}: ${pct(p.p)} to ${
    p.nextRound === "CHAMPION" ? "win" : "reach"
  } ${ROUND_LABEL[p.nextRound]}`;
}

/** One-line meter under the spirit team on the bracket pages. */
export function SpiritPulseLine({
  pulse,
  teamName,
}: {
  pulse: SpiritPulse;
  teamName: string;
}) {
  return (
    <div className="mt-1.5 text-xs text-muted-foreground">
      {pulseEmoji(pulse)} {pulseSentence(pulse, teamName)}
    </div>
  );
}
