"use client";

import { useEffect, useState } from "react";

// The "how old are these odds" text, ticking client-side so it stays honest on
// a server-rendered page (a bare timestamp would freeze at request time exactly
// when someone's refreshing after a game). Rendered inline in the OddsCard
// eyebrow, in place of the old static "updated live" label.

/** "just now" / "4m ago" / "2h ago" — minutes are the only unit that matters
 *  here (odds refresh on the ~20-min cron / on each result). */
function ago(fromIso: string, now: number): string {
  const secs = Math.max(0, Math.round((now - Date.parse(fromIso)) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export function UpdatedAgo({
  computedAt,
  pending = false,
}: {
  computedAt: string;
  /** A live/just-kicked-off result the odds haven't folded in yet. When set, the
   *  freshness text pulses gently — the only "an update is coming" signal we keep. */
  pending?: boolean;
}) {
  // Re-render every 30s so "4m ago" stays current without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (pending) {
    return <span className="animate-pulse">Updated {ago(computedAt, now)}</span>;
  }
  return <>Updated {ago(computedAt, now)}</>;
}
