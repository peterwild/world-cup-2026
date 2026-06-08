"use client";

import { useEffect, useState } from "react";

type Pool = { entrants: number; potCents: number };

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// Compact pot/entrants teaser for the entry screens. The entrant count is the
// real lever for a friend pool (social proof), so we lead with it once anyone's
// in. Hidden entirely until the first complete bracket — a "$0 pot · 0 in" strip
// deters rather than entices (cold-start optics).
export function PoolTeaser({
  className = "",
  showSplit = true,
}: {
  className?: string;
  // The logged-in Intro already states the 60/30/10 split in its description,
  // so it drops the redundant suffix; the login screen keeps it.
  showSplit?: boolean;
}) {
  const [pool, setPool] = useState<Pool | null>(null);

  useEffect(() => {
    fetch("/api/pool")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPool(d))
      .catch(() => setPool(null));
  }, []);

  if (!pool || pool.entrants < 1) return null;

  return (
    <div className={`card-surface rounded-full border border-border px-4 py-2 text-sm text-muted-foreground inline-flex items-center gap-1.5 max-w-full ${className}`}>
      <span>💰</span>
      <span className="font-semibold text-foreground tabular-nums">
        {usd(pool.potCents)}
      </span>
      <span>
        pot · {pool.entrants} in{showSplit ? " · top 3 paid 60/30/10" : ""}
      </span>
    </div>
  );
}
