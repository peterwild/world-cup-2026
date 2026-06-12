"use client";

import { useEffect, useRef, useState } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import type { LiveGame, FinishedGame, LiveView } from "@/lib/footballData";
import { Flag } from "@/components/Flag";

// Compact "Live & today" strip on the leaderboard. Polls /api/live (the box's
// self-throttling cache) and shows running scores — plus, the point of the
// thing, whether the team your bracket wants is currently ahead or behind.
//
// `rootMap` is keyed by `${home}-${away}` (team ids, real orientation) → the
// outcome that best helps YOU win the pool (from the odds snapshot's rooting
// buckets). Spirit team is the fallback signal when a game isn't in that map.

/** Outcome the user should root for, keyed by real home-away orientation. */
type RootMap = Record<string, "home" | "away" | "draw">;

/** Client poll cadence (the box caches harder upstream — this just keeps the UI
 *  live without hammering). Fast while a game is on, lazy otherwise. */
const POLL_LIVE = 30_000;
const POLL_SOON = 90_000;
const POLL_IDLE = 5 * 60_000;

function pairKey(home: string, away: string): string {
  return `${home}-${away}`;
}

function minuteLabel(g: LiveGame): string {
  if (g.status === "PAUSED") return "HT";
  if (g.minute != null) return `${g.minute}'`;
  return "LIVE";
}

/** The bracket overlay for one game: which side the user wants, and whether
 *  it's currently going their way. Returns null when nothing's at stake. */
function overlay(
  home: string,
  away: string,
  hg: number,
  ag: number,
  rootMap: RootMap,
  spiritTeamId: string | null,
): { emoji: string; label: string; tone: "good" | "bad" | "neutral" } | null {
  const want = rootMap[pairKey(home, away)];
  const spirit = spiritTeamId === home ? "home" : spiritTeamId === away ? "away" : null;
  const leader: "home" | "away" | "draw" = hg > ag ? "home" : ag > hg ? "away" : "draw";

  // Spirit team in this match — lead with the heart, it's the emotional hook.
  if (spirit) {
    if (leader === spirit) return { emoji: "💗", label: "your spirit team ahead", tone: "good" };
    if (leader === "draw") return { emoji: "💓", label: "your spirit team level", tone: "neutral" };
    return { emoji: "💔", label: "your spirit team trailing", tone: "bad" };
  }

  if (!want) return null;
  if (want === "draw") {
    if (leader === "draw") return { emoji: "✅", label: "you want the draw — level", tone: "good" };
    return { emoji: "⚠️", label: "you want a draw", tone: "bad" };
  }
  // You want a specific team to win.
  if (leader === want) return { emoji: "✅", label: "your pick ahead", tone: "good" };
  if (leader === "draw") return { emoji: "⚠️", label: "your pick held to a draw", tone: "neutral" };
  return { emoji: "⚠️", label: "your pick trailing", tone: "bad" };
}

function toneColor(tone: "good" | "bad" | "neutral"): string {
  return tone === "good" ? "var(--pitch)" : tone === "bad" ? "var(--destructive)" : "var(--muted-foreground)";
}

function LiveRow({
  g,
  rootMap,
  spiritTeamId,
  glow,
}: {
  g: LiveGame;
  rootMap: RootMap;
  spiritTeamId: string | null;
  glow: boolean;
}) {
  const home = TEAMS_BY_ID[g.home];
  const away = TEAMS_BY_ID[g.away];
  if (!home || !away) return null;
  const ov = overlay(g.home, g.away, g.homeGoals, g.awayGoals, rootMap, spiritTeamId);

  return (
    <div className={`rounded-lg p-2 ${glow ? "scored-glow" : ""}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 min-w-0">
          <Flag code={home.flag} sm />
          <span className="truncate">{home.name}</span>
        </span>
        {/* Score remounts on change (keyed) so the pop animation re-fires. */}
        <span
          key={`${g.homeGoals}-${g.awayGoals}`}
          className="score-pop font-extrabold tabular-nums text-base px-2"
        >
          {g.homeGoals}–{g.awayGoals}
        </span>
        <span className="flex items-center gap-1.5 min-w-0 justify-end">
          <span className="truncate">{away.name}</span>
          <Flag code={away.flag} sm />
        </span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="live-dot" aria-hidden />
          <span className="tabular-nums">{minuteLabel(g)}</span>
        </span>
        {ov && (
          <span className="font-medium" style={{ color: toneColor(ov.tone) }}>
            {ov.emoji} {ov.label}
          </span>
        )}
      </div>
    </div>
  );
}

function FinishedRow({
  g,
  rootMap,
  spiritTeamId,
}: {
  g: FinishedGame;
  rootMap: RootMap;
  spiritTeamId: string | null;
}) {
  const home = TEAMS_BY_ID[g.home];
  const away = TEAMS_BY_ID[g.away];
  if (!home || !away) return null;
  const ov = overlay(g.home, g.away, g.homeGoals, g.awayGoals, rootMap, spiritTeamId);

  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground py-0.5">
      <span className="flex items-center gap-1.5 min-w-0">
        <Flag code={home.flag} sm />
        <span className={`truncate ${g.winner === "home" ? "text-foreground font-medium" : ""}`}>
          {home.name}
        </span>
      </span>
      <span className="tabular-nums whitespace-nowrap px-1">
        {g.homeGoals}–{g.awayGoals}
        <span className="ml-1 eyebrow">FT</span>
      </span>
      <span className="flex items-center gap-1.5 min-w-0 justify-end">
        <span className={`truncate ${g.winner === "away" ? "text-foreground font-medium" : ""}`}>
          {away.name}
        </span>
        <Flag code={away.flag} sm />
        {ov && <span title={ov.label}>{ov.emoji}</span>}
      </span>
    </div>
  );
}

export function LiveStrip({
  rootMap,
  spiritTeamId,
}: {
  rootMap: RootMap;
  spiritTeamId: string | null;
}) {
  const [view, setView] = useState<LiveView | null>(null);
  // Game key → last seen "h-a" score, for detecting goals → glow.
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

        // Detect goals: a live game whose score grew → glow the card, and if it
        // was the user's team that scored, the glow reads as a little win.
        const fresh = new Set<string>();
        for (const g of next.live) {
          const key = g.id != null ? String(g.id) : pairKey(g.home, g.away);
          const now = `${g.homeGoals}-${g.awayGoals}`;
          const was = prevScores.current.get(key);
          if (was && was !== now) fresh.add(key);
          prevScores.current.set(key, now);
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

    // Pause polling when the tab's hidden; refetch immediately on return.
    function onVisibility() {
      if (document.hidden) {
        if (timer.current) clearTimeout(timer.current);
      } else {
        if (timer.current) clearTimeout(timer.current);
        tick();
      }
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
                rootMap={rootMap}
                spiritTeamId={spiritTeamId}
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
                rootMap={rootMap}
                spiritTeamId={spiritTeamId}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
