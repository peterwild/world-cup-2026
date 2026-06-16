"use client";

import { useEffect, useState } from "react";

// The "how old are these odds" line. Client-side so the relative time ticks
// without a reload — the page is server-rendered, so a bare timestamp would
// freeze at request time and read stale exactly when someone's refreshing after
// a game. `pending` is the check-after-the-whistle saver: when a game is live
// (or just kicked off and the feed's catching up) the odds correctly haven't
// folded in the final yet, so we say so instead of showing silent stale numbers.

/** "just now" / "4m ago" / "2h ago" — minutes are the only unit that matters
 *  here (odds refresh on the ~20-min cron). */
function ago(fromIso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export function OddsFreshness({
  computedAt,
  pending,
}: {
  computedAt: string;
  /** When set, a game is live/just-kicked-off: the odds will fold its result in
   *  once it ends. Short label, e.g. "Live — odds update when it ends". */
  pending?: string | null;
}) {
  // Re-render every 30s so "4m ago" stays honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="eyebrow text-muted-foreground">Updated {ago(computedAt, now)}</span>
      {pending && (
        <span
          className="eyebrow inline-flex items-center gap-1 rounded-full px-2 py-0.5"
          style={{ background: "var(--destructive)", color: "white", opacity: 0.85 }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          {pending}
        </span>
      )}
    </div>
  );
}
