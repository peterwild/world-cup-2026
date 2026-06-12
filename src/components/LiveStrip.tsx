"use client";

import { useEffect, useRef, useState } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import type { LiveGame, FinishedGame, LiveView } from "@/lib/footballData";
import { Flag } from "@/components/Flag";

// Compact "Live & today" strip on the leaderboard. Polls /api/live (the box's
// self-throttling cache) and shows running scores. For a LIVE game it spells out
// who to root for and whether they're winning, plus the loved "46% → 49%" odds
// swing. For TODAY's finished games it shows whether your bracket pick won.
//
// Two signals feed it:
//  • `arrows` — the odds snapshot's rooting recommendation (who to root for to
//    win the pool, + the swing). Only exists for live/upcoming fixtures.
//  • `back` — how deep your bracket carried each team (lib/bracketState). The
//    fallback when there's no odds entry, and what settles finished games.

type Side = "home" | "away";
type Leader = Side | "draw";
type Tone = "good" | "bad" | "neutral";

/** team id → how deep your bracket backed it (≥1 = picked into the knockouts). */
type BackDepth = Record<string, number>;
/** `${home}-${away}` → the result to root for + your P(win pool) if it lands. */
type RootArrow = { outcome: Leader; win: number };
type RootArrows = Record<string, RootArrow>;

const POLL_LIVE = 30_000;
const POLL_SOON = 90_000;
const POLL_IDLE = 5 * 60_000;

function pairKey(home: string, away: string): string {
  return `${home}-${away}`;
}

/** "9.0%" / "11.4%" — one decimal so both sides of the arrow line up. */
function pct1(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function minuteLabel(g: LiveGame): string {
  if (g.status === "PAUSED") return "Halftime";
  if (g.minute != null) return `${g.minute}'`;
  return "LIVE";
}

function leaderOf(hg: number, ag: number): Leader {
  return hg > ag ? "home" : ag > hg ? "away" : "draw";
}

/** Which side your bracket backs, or null if neither (or both equally). */
function backedSide(home: string, away: string, back: BackDepth): Side | null {
  const dh = back[home] ?? 0;
  const da = back[away] ?? 0;
  if (Math.max(dh, da) < 1) return null;
  if (Math.abs(dh - da) < 0.05) return null;
  return dh > da ? "home" : "away";
}

function toneColor(tone: Tone): string {
  return tone === "good" ? "var(--pitch)" : tone === "bad" ? "var(--destructive)" : "var(--muted-foreground)";
}

// ── LIVE game: who to root for + is it going your way ────────────────────────
interface LiveCall {
  /** The result to root for. team id, or "draw", or null (no stake). */
  root: string | "draw" | null;
  /** A pure-spirit root (nothing on the line but the heart). */
  spiritOnly: boolean;
  emoji: string;
  tone: Tone;
  /** Spirit-team heart that rides along when you DO have a pool stake. */
  heart: string;
}

function liveCall(
  home: string,
  away: string,
  hg: number,
  ag: number,
  arrow: RootArrow | undefined,
  back: BackDepth,
  spiritTeamId: string | null,
): LiveCall {
  const leader = leaderOf(hg, ag);
  const spiritSide: Side | null = spiritTeamId === home ? "home" : spiritTeamId === away ? "away" : null;

  // Who to root for to win the pool: odds recommendation first, then bracket.
  const outcome: Leader | null = arrow ? arrow.outcome : backedSide(home, away, back);

  if (outcome === null) {
    // No pool stake — root for your spirit team if it's playing, else nothing.
    if (spiritSide) {
      const emoji = leader === spiritSide ? "💗" : leader === "draw" ? "💓" : "💔";
      const tone: Tone = leader === spiritSide ? "good" : leader === "draw" ? "neutral" : "bad";
      return { root: spiritSide === "home" ? home : away, spiritOnly: true, emoji, tone, heart: "" };
    }
    return { root: null, spiritOnly: false, emoji: "🍿", tone: "neutral", heart: "" };
  }

  // You have someone to pull for — is the game going their way?
  let emoji: string;
  let tone: Tone;
  if (outcome === "draw") {
    emoji = leader === "draw" ? "✅" : "😬";
    tone = leader === "draw" ? "good" : "bad";
  } else if (leader === outcome) {
    emoji = "✅";
    tone = "good";
  } else if (leader === "draw") {
    emoji = "😐";
    tone = "neutral";
  } else {
    emoji = "😬";
    tone = "bad";
  }
  // No spirit heart on the root line — a bare heart next to "Root for KOR" reads
  // as if rooting for Korea is the sad part. Spirit conflict lives in the
  // upcoming "who to root for" card, which has room for the words.
  const root = outcome === "draw" ? "draw" : outcome === "home" ? home : away;
  return { root, spiritOnly: false, emoji, tone, heart: "" };
}

/** "Root for 🇰🇷 KOR" / "Root for 🤝 a draw" — the headline for a live game. */
function RootFor({ call }: { call: LiveCall }) {
  if (call.root === null) {
    return <span className="font-medium" style={{ color: toneColor(call.tone) }}>{call.emoji} no stake — enjoy</span>;
  }
  const team = call.root === "draw" ? null : TEAMS_BY_ID[call.root];
  return (
    <span className="font-medium inline-flex items-center gap-1" style={{ color: toneColor(call.tone) }}>
      <span>{call.emoji}</span>
      <span>Root for</span>
      {team ? (
        <>
          <Flag code={team.flag} sm />
          <span>{team.name}</span>
        </>
      ) : (
        <span>🤝 a draw</span>
      )}
      {call.heart && <span>{call.heart}</span>}
    </span>
  );
}

// ── FINISHED game: did the team you wanted come through? ──────────────────────
// Names the team you were rooting for so the result line reads on its own — a
// bare 🎉 next to a score is ambiguous if you've forgotten who you were pulling
// for. `rootId` is that team; the heart vs party emoji marks spirit vs bracket.
function finishedVerdict(
  home: string,
  away: string,
  hg: number,
  ag: number,
  back: BackDepth,
  spiritTeamId: string | null,
): { emoji: string; rootId: string; verb: string; tone: Tone } | null {
  const leader = leaderOf(hg, ag);
  const want = backedSide(home, away, back);
  const spirit: Side | null = spiritTeamId === home ? "home" : spiritTeamId === away ? "away" : null;

  if (want) {
    const rootId = want === "home" ? home : away;
    if (leader === want) return { emoji: "🎉", rootId, verb: "won", tone: "good" };
    if (leader === "draw") return { emoji: "😕", rootId, verb: "only drew", tone: "neutral" };
    return { emoji: "😞", rootId, verb: "lost", tone: "bad" };
  }
  if (spirit) {
    const rootId = spirit === "home" ? home : away;
    if (leader === spirit) return { emoji: "💗", rootId, verb: "won", tone: "good" };
    if (leader === "draw") return { emoji: "💓", rootId, verb: "drew", tone: "neutral" };
    return { emoji: "💔", rootId, verb: "lost", tone: "bad" };
  }
  return null; // no stake — stay quiet on the results list
}

function LiveRow({
  g,
  back,
  spiritTeamId,
  arrows,
  baselineWin,
  glow,
}: {
  g: LiveGame;
  back: BackDepth;
  spiritTeamId: string | null;
  arrows: RootArrows;
  baselineWin: number;
  glow: boolean;
}) {
  const home = TEAMS_BY_ID[g.home];
  const away = TEAMS_BY_ID[g.away];
  if (!home || !away) return null;
  const arrow = arrows[pairKey(g.home, g.away)];
  const call = liveCall(g.home, g.away, g.homeGoals, g.awayGoals, arrow, back, spiritTeamId);
  const showArrow = arrow !== undefined && baselineWin > 0;

  return (
    <div className={`rounded-lg p-2 ${glow ? "scored-glow" : ""}`}>
      {/* 1fr · auto · 1fr keeps the score dead-center no matter the name widths. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
        <span className="flex items-center gap-1.5 min-w-0">
          <Flag code={home.flag} sm />
          <span className="truncate">{home.name}</span>
        </span>
        {/* Score remounts on change (keyed) so the pop animation re-fires. */}
        <span
          key={`${g.homeGoals}-${g.awayGoals}`}
          className="score-pop font-extrabold tabular-nums text-base px-2 text-center"
        >
          {g.homeGoals}–{g.awayGoals}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 justify-end">
          <span className="truncate">{away.name}</span>
          <Flag code={away.flag} sm />
        </span>
      </div>
      {/* Everything about the game's state stacks centered under the score:
          the clock, who to root for, and the odds swing. */}
      <div className="mt-1 flex flex-col items-center gap-0.5 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {/* Amber static dot at halftime (paused), pulsing red while in play. */}
          <span className={g.status === "PAUSED" ? "pause-dot" : "live-dot"} aria-hidden />
          <span className="tabular-nums">{minuteLabel(g)}</span>
        </span>
        <RootFor call={call} />
        {showArrow && (
          <div
            className="tabular-nums"
            title={`If the result you want lands, your odds to win the pool go to ${pct1(arrow.win)}.`}
          >
            <span className="text-muted-foreground">{pct1(baselineWin)} → </span>
            <span
              className="font-semibold"
              style={{ color: arrow.win >= baselineWin ? "var(--pitch)" : "var(--destructive)" }}
            >
              {pct1(arrow.win)}
            </span>
            <span className="text-muted-foreground"> win odds</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FinishedRow({
  g,
  back,
  spiritTeamId,
}: {
  g: FinishedGame;
  back: BackDepth;
  spiritTeamId: string | null;
}) {
  const home = TEAMS_BY_ID[g.home];
  const away = TEAMS_BY_ID[g.away];
  if (!home || !away) return null;
  const v = finishedVerdict(g.home, g.away, g.homeGoals, g.awayGoals, back, spiritTeamId);
  const rootTeam = v ? TEAMS_BY_ID[v.rootId] : null;

  return (
    <div className="py-0.5">
      {/* Match grid with the score dead-center, matching the live rows above. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
        <span className="flex items-center gap-1.5 min-w-0 text-muted-foreground">
          <Flag code={home.flag} sm />
          <span className={`truncate ${g.winner === "home" ? "text-foreground font-medium" : ""}`}>
            {home.name}
          </span>
        </span>
        <span className="tabular-nums text-muted-foreground whitespace-nowrap text-center">
          {g.homeGoals}–{g.awayGoals}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 justify-end text-muted-foreground">
          <span className={`truncate ${g.winner === "away" ? "text-foreground font-medium" : ""}`}>
            {away.name}
          </span>
          <Flag code={away.flag} sm />
        </span>
      </div>
      {/* Centered status + verdict, mirroring the live rows: "Full Time" is the
          match state (its own line), and who you pulled for is a separate line
          below it — so the 🎉/💔 isn't a lone, ambiguous emoji. */}
      <div className="mt-0.5 flex flex-col items-center gap-0.5 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="done-dot" aria-hidden />
          <span>Full Time</span>
        </span>
        {v && rootTeam && (
          <div
            className="flex items-center justify-center flex-wrap gap-1"
            style={{ color: toneColor(v.tone) }}
          >
            <span>{v.emoji}</span>
            <span>rooted for</span>
            <Flag code={rootTeam.flag} sm />
            <span className="font-medium">{rootTeam.name}</span>
            <span>· {v.verb}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function LiveStrip({
  back,
  spiritTeamId,
  arrows,
  baselineWin,
}: {
  back: BackDepth;
  spiritTeamId: string | null;
  arrows: RootArrows;
  baselineWin: number;
}) {
  const [view, setView] = useState<LiveView | null>(null);
  const prevScores = useRef<Map<string, string>>(new Map());
  const [glowing, setGlowing] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function cadence(v: LiveView | null): number {
      if (v?.live.length) return POLL_LIVE;
      if (v?.nextKickoff && Date.parse(v.nextKickoff) - Date.now() < 30 * 60_000) return POLL_SOON;
      return POLL_IDLE;
    }

    async function tick() {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as LiveView;
        if (cancelled) return;

        // Detect goals: a live game whose score grew → glow the card.
        const fresh = new Set<string>();
        for (const g of next.live) {
          const key = g.id != null ? String(g.id) : pairKey(g.home, g.away);
          const score = `${g.homeGoals}-${g.awayGoals}`;
          const was = prevScores.current.get(key);
          if (was && was !== score) fresh.add(key);
          prevScores.current.set(key, score);
        }
        if (fresh.size) {
          setGlowing(fresh);
          setTimeout(() => !cancelled && setGlowing(new Set()), 1500);
        }
        setView(next);
        timer.current = setTimeout(tick, cadence(next));
      } catch {
        if (!cancelled) timer.current = setTimeout(tick, POLL_SOON);
      }
    }

    function onVisibility() {
      if (timer.current) clearTimeout(timer.current);
      if (!document.hidden) tick();
    }

    tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!view || (view.live.length === 0 && view.finishedToday.length === 0)) return null;

  return (
    <section className="mt-3 card-surface rounded-xl p-3 border border-border">
      <div className="eyebrow mb-2 flex items-center gap-1.5">
        {view.live.length > 0 ? (
          <>
            <span className="live-dot" aria-hidden /> Live now
            {/* Free-tier feed runs a few minutes behind real life — say so, so a
                stale-looking score doesn't read as broken. Only while live. */}
            <span className="opacity-70">· Scores ~5 min delayed</span>
          </>
        ) : (
          <>⚽ Today&apos;s results</>
        )}
      </div>

      {view.live.length > 0 && (
        <div className="space-y-1.5">
          {view.live.map((g) => {
            const key = g.id != null ? String(g.id) : pairKey(g.home, g.away);
            return (
              <LiveRow
                key={key}
                g={g}
                back={back}
                spiritTeamId={spiritTeamId}
                arrows={arrows}
                baselineWin={baselineWin}
                glow={glowing.has(key)}
              />
            );
          })}
        </div>
      )}

      {view.finishedToday.length > 0 && (
        <div className={view.live.length > 0 ? "mt-2 pt-2 border-t border-border" : ""}>
          {view.live.length > 0 && <div className="eyebrow mb-1">Earlier today</div>}
          <div className="space-y-0.5">
            {view.finishedToday.map((g) => (
              <FinishedRow
                key={g.id != null ? String(g.id) : pairKey(g.home, g.away)}
                g={g}
                back={back}
                spiritTeamId={spiritTeamId}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
