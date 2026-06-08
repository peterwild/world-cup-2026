"use client";

import { useEffect, useState } from "react";

// Tiny live countdown to a target ISO time. Renders nothing until mounted to
// avoid a server/client clock mismatch (the server's "now" ≠ the browser's).
// Shows days when far out, drops to a ticking seconds view in the final hour.
export function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0); // async first paint — no sync setState in effect
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  if (now === null) return null;

  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return <span className="tabular-nums">kickoff! ⚽️</span>;

  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);

  const text =
    d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;

  return <span className="tabular-nums">{text}</span>;
}
