"use client";

import { useEffect, useRef, useState } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import type { LiveGame, FinishedGame, LiveView } from "@/lib/footballData";
import { type BackDepth, backedSide, backDepthPhrase } from "@/lib/bracketState";
import { Flag } from "@/components/Flag";

// Compact "Live & today" strip on the leaderboard. Polls /api/live (the box's
// self-throttling cache) and shows running scores. For a LIVE game it spells out
// who to root for — the team YOUR bracket carries further — and whether they're
// winning. For TODAY's finished games it shows whether that pick came through.
//
// One signal feeds the recommendation: `back`, how deep your bracket carried
// each team (lib/bracketState). Always available, never contradicts your
// picks — what you see is the team you actually chose.

type Side = "home" | "away";
type Leader = Side | "draw";
type Tone = "good" | "bad" | "neutral";

const POLL_LIVE = 30_000;
const POLL_SOON = 90_000;
const POLL_IDLE = 5 * 60_000;

function pairKey(home: string, away: string): string {
  return `${home}-${away}`;
}

function minuteLabel(g: LiveGame): string {
  if (g.status === "PAUSED") return "Halftime";
  if (g.minute != null) return `${g.minute}'`;
  return "LIVE";
}

function leaderOf(hg: number, ag: number): Leader {
  return hg > ag ? "home" : ag > hg ? "away" : "draw";
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
  back: BackDepth,
  spiritTeamId: string | null,
): LiveCall {
  const leader = leaderOf(hg, ag);
  const spiritSide: Side | null = spiritTeamId === home ? "home" : spiritTeamId === away ? "away" : null;

  // Who to root for: the team your bracket carries further. No pool math.
  const outcome: Side | null = backedSide(home, away, back);

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
  if (leader === outcome) {
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
  const root = outcome === "home" ? home : away;
  return { root, spiritOnly: false, emoji, tone, heart: "" };
}

/** "Rooting for 🇰🇷 KOR" — the headline for a live game. Present progressive
 *  (vs. the upcoming card's imperative "Root for"): the match is on now, so it
 *  reads as an in-the-moment state. On a friend's page `whose` makes it theirs
 *  ("Dejan's rooting for…") so it never reads as your own stake. */
function RootFor({ call, whose }: { call: LiveCall; whose?: string }) {
  if (call.root === null) {
    return (
      <span className="font-medium" style={{ color: toneColor(call.tone) }}>
        {call.emoji} no stake{whose ? ` for ${whose}` : " — enjoy"}
      </span>
    );
  }
  const team = call.root === "draw" ? null : TEAMS_BY_ID[call.root];
  return (
    <span className="font-medium inline-flex items-center gap-1" style={{ color: toneColor(call.tone) }}>
      <span>{call.emoji}</span>
      <span>{whose ? `${whose}'s rooting for` : "Rooting for"}</span>
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
//
// Same source as the live "Rooting for X" line — your deepest bracket pick, then
// your spirit team — so what we said during the game and the post-game verdict
// can't disagree, and neither ever contradicts your bracket.
function finishedVerdict(
  home: string,
  away: string,
  hg: number,
  ag: number,
  back: BackDepth,
  spiritTeamId: string | null,
): { emoji: string; rootId: string | null; verb: string; tone: Tone } | null {
  const leader = leaderOf(hg, ag);
  const spirit: Side | null = spiritTeamId === home ? "home" : spiritTeamId === away ? "away" : null;

  const want = backedSide(home, away, back);
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
  whose,
  glow,
}: {
  g: LiveGame;
  back: BackDepth;
  spiritTeamId: string | null;
  whose?: string;
  glow: boolean;
}) {
  const home = TEAMS_BY_ID[g.home];
  const away = TEAMS_BY_ID[g.away];
  if (!home || !away) return null;
  const call = liveCall(g.home, g.away, g.homeGoals, g.awayGoals, back, spiritTeamId);
  // "why" line: how deep the bracket carries the team being pulled for.
  const possessive = whose ? `${whose}'s` : "your";
  const rootDepth = call.root && call.root !== "draw" ? back[call.root] ?? 0 : 0;
  const whyPhrase =
    call.root && !call.spiritOnly && rootDepth > 0 ? backDepthPhrase(rootDepth, possessive) : null;

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
          the clock, who to root for, and why they're on your card. */}
      <div className="mt-1 flex flex-col items-center gap-0.5 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {/* Amber static dot at halftime (paused), pulsing red while in play. */}
          <span className={g.status === "PAUSED" ? "pause-dot" : "live-dot"} aria-hidden />
          <span className="tabular-nums">{minuteLabel(g)}</span>
        </span>
        <RootFor call={call} whose={whose} />
        {whyPhrase && <span className="text-muted-foreground">{whyPhrase}</span>}
      </div>
    </div>
  );
}

function FinishedRow({
  g,
  back,
  spiritTeamId,
  whose,
}: {
  g: FinishedGame;
  back: BackDepth;
  spiritTeamId: string | null;
  whose?: string;
}) {
  const home = TEAMS_BY_ID[g.home];
  const away = TEAMS_BY_ID[g.away];
  if (!home || !away) return null;
  const v = finishedVerdict(g.home, g.away, g.homeGoals, g.awayGoals, back, spiritTeamId);
  const rootTeam = v && v.rootId ? TEAMS_BY_ID[v.rootId] : null;

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
        {v && (rootTeam || v.rootId === null) && (
          <div
            className="flex items-center justify-center flex-wrap gap-1"
            style={{ color: toneColor(v.tone) }}
          >
            <span>{v.emoji}</span>
            <span>{whose ? `${whose} rooted for` : "rooted for"}</span>
            {rootTeam ? (
              <>
                <Flag code={rootTeam.flag} sm />
                <span className="font-medium">{rootTeam.name}</span>
              </>
            ) : (
              <span className="font-medium">🤝 a draw</span>
            )}
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
  whose,
}: {
  back: BackDepth;
  spiritTeamId: string | null;
  /** First name when shown on a friend's page — makes the rooting line theirs
   *  ("Dejan's rooting for…"). Omitted = your own page (second person). */
  whose?: string;
}) {
  const [view, setView] = useState<LiveView | null>(null);
  const prevScores = useRef<Map<string, string>>(new Map());
  const [glowing, setGlowing] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    function cadence(v: LiveView | null): number {
      // Poll fast while live OR awaiting a lagging kickoff — otherwise the strip
      // sits empty on the box's stale cache through the start of a match.
      if (v?.live.length || v?.awaitingKickoff) return POLL_LIVE;
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
            <span>· Scores ~5 min delayed</span>
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
                whose={whose}
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
                whose={whose}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
