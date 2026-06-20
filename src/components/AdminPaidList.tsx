"use client";

import { useState } from "react";

// Admin-only buy-in tracker. Each row toggles a player's paid flag via
// /api/admin/paid (session-gated to the admin) — `kind` picks which pot (the
// bracket pool or the Golden Boot side bet). Optimistic: flip the UI, POST,
// revert on failure. Rendered only inside the server-gated /admin page, so this
// paid data never reaches a non-admin browser.

type Row = { id: string; name: string; paid: boolean };

function fmtUsd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function AdminPaidList({
  label,
  players,
  buyInCents,
  kind = "pool",
  emptyNote = "Nobody here yet.",
}: {
  /** Eyebrow heading, e.g. "Pool buy-ins" / "Golden Boot buy-ins". */
  label: string;
  players: Row[];
  buyInCents: number;
  kind?: "pool" | "goldenBoot";
  /** Shown instead of the list when there are no players in this pot. */
  emptyNote?: string;
}) {
  const [rows, setRows] = useState<Row[]>(players);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paidCount = rows.filter((r) => r.paid).length;

  async function toggle(id: string, next: boolean) {
    setError(null);
    setBusy(id);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, paid: next } : r)));
    try {
      const res = await fetch("/api/admin/paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId: id, paid: next, kind }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { paid: boolean };
      // Trust the server's echoed value.
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, paid: data.paid } : r)));
    } catch {
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, paid: !next } : r))); // revert
      setError("Couldn't save — try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-3 card-surface rounded-xl p-4 border border-border">
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="eyebrow">{label}</div>
          <div className="text-2xl font-extrabold tabular-nums">
            {paidCount}
            <span className="text-muted-foreground text-base font-medium"> / {rows.length}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="eyebrow">Collected</div>
          <div className="text-lg font-semibold tabular-nums">
            {fmtUsd(paidCount * buyInCents)}
          </div>
        </div>
      </div>

      {error && <div className="mb-2 text-xs text-destructive">{error}</div>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyNote}</p>
      ) : (
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate font-medium">{r.name}</span>
            <button
              type="button"
              disabled={busy === r.id}
              onClick={() => toggle(r.id, !r.paid)}
              className="shrink-0 rounded-full px-3 py-1 text-xs font-semibold border transition-colors disabled:opacity-50"
              style={{
                color: r.paid ? "var(--pitch)" : "var(--muted-foreground)",
                borderColor: r.paid ? "var(--pitch)" : "var(--border)",
                background: r.paid ? "color-mix(in oklab, var(--pitch) 12%, transparent)" : "transparent",
              }}
              aria-pressed={r.paid}
            >
              {busy === r.id ? "…" : r.paid ? "✓ Paid" : "Mark paid"}
            </button>
          </li>
        ))}
      </ul>
      )}
    </section>
  );
}
