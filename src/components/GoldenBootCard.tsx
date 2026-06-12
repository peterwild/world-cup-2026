"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Golden Boot side bet, surfaced on the leaderboard (where every post-lock
// player lands). Self-fetches /api/golden-boot and renders one of:
//   • the opt-in prompt (I'm in / No thanks / Decide later)  ← unanswered
//   • the player picker (searchable, grouped by team)        ← opted in, no pick
//   • a compact status line                                  ← picked / declined
//   • read-only + outcome                                    ← locked / resolved
// "Decide later" is a session-only snooze (no server write) so someone just
// checking standings can dismiss it and it returns next visit.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from "react";
import { TEAMS_BY_ID } from "@/lib/teams";
import { ELO } from "@/lib/elo";
import { Flag } from "./Flag";

interface Candidate {
  id: string;
  name: string;
  teamId: string;
}

interface ScorerRow {
  id: string;
  name: string;
  teamId: string | null;
  goals: number;
}

interface GoldenBootView {
  status: "in" | "declined" | null;
  pickId: string | null;
  paid: boolean;
  candidates: Candidate[];
  buyInCents: number;
  lockAt: string | null;
  locked: boolean;
  result: string | null;
  pot: number;
  participants: number;
  pickGoals: number | null;
  topScorers: ScorerRow[];
}

const SNOOZE_KEY = "gb_snoozed";

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** "· 3 goals" / "· 1 goal" / "· yet to score" for a pick's tally. */
function goalsLabel(goals: number | null): string {
  if (goals === null) return "· yet to score";
  return `· ${goals} ${goals === 1 ? "goal" : "goals"}`;
}

/** Compact live top-5 Golden Boot race; highlights the viewer's pick. */
function Race({ scorers, myPickId }: { scorers: ScorerRow[]; myPickId: string | null }) {
  if (scorers.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: GOLD }}>
      <div className="eyebrow" style={{ color: GOLD }}>
        Golden Boot race
      </div>
      <div className="mt-1.5 space-y-1">
        {scorers.map((s, i) => {
          const mine = s.id === myPickId;
          const team = s.teamId ? TEAMS_BY_ID[s.teamId] : null;
          return (
            <div
              key={s.id}
              className="flex items-center gap-1.5 text-sm"
              style={mine ? { fontWeight: 600, color: GOLD } : undefined}
            >
              <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
              {team && <Flag code={team.flag} sm />}
              <span className="flex-1 truncate">
                {s.name}
                {mine && " (you)"}
              </span>
              <span className="tabular-nums font-semibold">{s.goals}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const GOLD = "var(--podium-gold)";
const GOLD_SOFT = "var(--podium-gold-soft)";

export function GoldenBootCard() {
  const [view, setView] = useState<GoldenBootView | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false); // picker open
  const [snoozed, setSnoozed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/golden-boot")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: GoldenBootView | null) => {
        if (!alive) return;
        setSnoozed(sessionStorage.getItem(SNOOZE_KEY) === "1");
        setView(d);
      })
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, []);

  async function act(action: "opt_in" | "decline" | "pick", pickId?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/golden-boot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, pickId }),
      });
      if (res.ok) {
        const fresh = await fetch("/api/golden-boot").then((r) => r.json());
        setView(fresh as GoldenBootView);
        setPicking(false);
      }
    } finally {
      setBusy(false);
    }
  }

  function snooze() {
    sessionStorage.setItem(SNOOZE_KEY, "1");
    setSnoozed(true);
  }
  function unsnooze() {
    sessionStorage.removeItem(SNOOZE_KEY);
    setSnoozed(false);
  }

  if (!view) return null; // loading or not signed in

  const { status, pickId, paid, candidates, buyInCents, locked, result, pickGoals, topScorers } = view;
  const pickCand = candidates.find((c) => c.id === pickId) ?? null;
  const resultCand = result ? candidates.find((c) => c.id === result) ?? null : null;

  // Bet is over and this player never joined → nothing to show.
  if (locked && status === null && !result) return null;

  const shell = (children: React.ReactNode) => (
    <section
      className="mt-3 rounded-xl p-4 border"
      style={{ background: GOLD_SOFT, borderColor: GOLD }}
    >
      {children}
    </section>
  );

  // ── Resolved: show this player's outcome ──
  if (result && resultCand) {
    const won = status === "in" && pickId === result;
    const inPool = status === "in" && !!pickId;
    return shell(
      <div>
        <div className="eyebrow" style={{ color: GOLD }}>
          🥇 Golden Boot · {usd(view.pot)} pot
        </div>
        <div className="mt-1 text-sm flex items-center gap-1.5">
          <span className="text-muted-foreground">Top scorer:</span>
          {TEAMS_BY_ID[resultCand.teamId] && (
            <Flag code={TEAMS_BY_ID[resultCand.teamId].flag} sm />
          )}
          <span className="font-semibold">{resultCand.name}</span>
        </div>
        <div className="mt-1 text-sm font-medium">
          {won
            ? `🎉 You called it — ${usd(view.pot / Math.max(1, view.participants))} (split among correct picks).`
            : inPool
              ? "Not your pick this time."
              : "You sat this one out."}
        </div>
        <Race scorers={topScorers} myPickId={pickId} />
      </div>,
    );
  }

  // ── Locked, pre-result: read-only + live race ──
  if (locked) {
    return shell(
      <div>
        <div className="eyebrow" style={{ color: GOLD }}>
          🥇 Golden Boot · locked · {usd(view.pot)} pot
        </div>
        <div className="mt-1 text-sm">
          {status === "in" && pickCand ? (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Your pick:</span>
              {TEAMS_BY_ID[pickCand.teamId] && <Flag code={TEAMS_BY_ID[pickCand.teamId].flag} sm />}
              <span className="font-semibold">{pickCand.name}</span>
              <span className="text-muted-foreground">
                {goalsLabel(pickGoals)} · {paid ? "paid ✓" : "payment pending"}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">Picks are closed. You&apos;re not in this pot.</span>
          )}
        </div>
        <Race scorers={topScorers} myPickId={pickId} />
      </div>,
    );
  }

  // ── Open: picker (opted in, choosing) ──
  if (picking || (status === "in" && !pickId)) {
    return shell(
      <Picker
        candidates={candidates}
        current={pickId}
        busy={busy}
        onCancel={status === "in" && pickId ? () => setPicking(false) : null}
        onPick={(id) => act("pick", id)}
        buyInCents={buyInCents}
      />,
    );
  }

  // ── Open: opted in WITH a pick → compact status + live race ──
  if (status === "in" && pickCand) {
    return shell(
      <div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="eyebrow" style={{ color: GOLD }}>
              🥇 Golden Boot · {usd(view.pot)} pot
            </div>
            <div className="mt-1 text-sm flex items-center gap-1.5">
              <span className="text-muted-foreground">Your pick:</span>
              {TEAMS_BY_ID[pickCand.teamId] && <Flag code={TEAMS_BY_ID[pickCand.teamId].flag} sm />}
              <span className="font-semibold truncate">{pickCand.name}</span>
              <span className="text-muted-foreground shrink-0">{goalsLabel(pickGoals)}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {paid ? "Paid ✓" : `${usd(buyInCents)} — settle up with your host`}
            </div>
          </div>
          <button
            onClick={() => setPicking(true)}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border active:scale-[0.98] transition"
            style={{ borderColor: GOLD, color: GOLD }}
          >
            Change
          </button>
        </div>
        <Race scorers={topScorers} myPickId={pickId} />
      </div>,
    );
  }

  // ── Open: declined → unobtrusive, reversible ──
  if (status === "declined") {
    return shell(
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">🥇 Golden Boot — sitting this one out.</span>
        <button
          onClick={() => act("opt_in")}
          disabled={busy}
          className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border active:scale-[0.98] transition disabled:opacity-40"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          Actually, I&apos;m in
        </button>
      </div>,
    );
  }

  // ── Unanswered + snoozed → tiny re-openable chip ──
  if (snoozed) {
    return (
      <button
        onClick={unsnooze}
        className="mt-3 w-full text-left text-xs font-medium px-3 py-2 rounded-lg border active:scale-[0.99] transition"
        style={{ borderColor: GOLD, color: GOLD, background: GOLD_SOFT }}
      >
        🥇 Golden Boot side bet · decide later ▸
      </button>
    );
  }

  // ── Unanswered → the opt-in prompt ──
  return shell(
    <div>
      <div className="eyebrow" style={{ color: GOLD }}>
        🥇 New side bet
      </div>
      <div className="mt-1 font-semibold">Golden Boot 👟 — pick the tournament&apos;s top scorer</div>
      <p className="mt-1 text-sm text-muted-foreground">
        {`An extra ${usd(buyInCents)} into a separate pot from the main bracket. ` +
          `Correct pickers split it; if nobody nails it, everyone who's in gets ` +
          `refunded. Locks when the group stage ends.`}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => act("opt_in")}
          disabled={busy}
          className="text-sm font-semibold px-4 py-2 rounded-lg active:scale-[0.98] transition disabled:opacity-40"
          style={{ background: GOLD, color: "white" }}
        >
          I&apos;m in
        </button>
        <button
          onClick={() => act("decline")}
          disabled={busy}
          className="text-sm font-medium px-4 py-2 rounded-lg border active:scale-[0.98] transition disabled:opacity-40"
          style={{ borderColor: "var(--border)" }}
        >
          No thanks
        </button>
        <button
          onClick={snooze}
          disabled={busy}
          className="text-sm font-medium px-4 py-2 rounded-lg active:scale-[0.98] transition disabled:opacity-40 text-muted-foreground"
        >
          Decide later
        </button>
      </div>
    </div>,
  );
}

// ── Searchable picker, grouped by team ───────────────────────────────────────
function Picker({
  candidates,
  current,
  busy,
  onPick,
  onCancel,
  buyInCents,
}: {
  candidates: Candidate[];
  current: string | null;
  busy: boolean;
  onPick: (id: string) => void;
  onCancel: (() => void) | null;
  buyInCents: number;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<string | null>(current);

  // Group by team (strongest first, by Elo — contenders lead the default view),
  // players alpha within. Filter by query.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byTeam = new Map<string, Candidate[]>();
    for (const c of candidates) {
      if (q && !c.name.toLowerCase().includes(q) && !(TEAMS_BY_ID[c.teamId]?.name.toLowerCase().includes(q))) {
        continue;
      }
      (byTeam.get(c.teamId) ?? byTeam.set(c.teamId, []).get(c.teamId)!).push(c);
    }
    return [...byTeam.entries()]
      .map(([teamId, list]) => ({
        teamId,
        team: TEAMS_BY_ID[teamId],
        list: list.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort(
        (a, b) =>
          (ELO[b.teamId] ?? 0) - (ELO[a.teamId] ?? 0) ||
          (a.team?.name ?? a.teamId).localeCompare(b.team?.name ?? b.teamId),
      );
  }, [candidates, query]);

  const selCand = candidates.find((c) => c.id === sel) ?? null;

  return (
    <div>
      <div className="eyebrow" style={{ color: GOLD }}>
        👟 Pick your Golden Boot
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search player or country…"
        className="mt-2 w-full px-3 py-2 rounded-lg bg-card border border-border outline-none focus:border-[var(--podium-gold)] transition text-sm"
      />
      <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {groups.length === 0 && (
          <div className="px-3 py-4 text-sm text-muted-foreground text-center">No players match.</div>
        )}
        {groups.map((g) => (
          <div key={g.teamId}>
            <div className="sticky top-0 bg-card px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 text-muted-foreground">
              {g.team && <Flag code={g.team.flag} sm />}
              <span>{g.team?.name ?? g.teamId}</span>
            </div>
            {g.list.map((c) => {
              const active = sel === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => setSel(c.id)}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition"
                  style={active ? { background: GOLD_SOFT, color: GOLD, fontWeight: 600 } : undefined}
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {active && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => sel && onPick(sel)}
          disabled={busy || !sel}
          className="text-sm font-semibold px-4 py-2 rounded-lg active:scale-[0.98] transition disabled:opacity-40"
          style={{ background: GOLD, color: "white" }}
        >
          {selCand ? (
            <>
              <span className="mr-1.5" aria-hidden>👟</span>
              Lock in {selCand.name}
            </>
          ) : (
            "Pick a player"
          )}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="text-sm font-medium px-4 py-2 rounded-lg border active:scale-[0.98] transition disabled:opacity-40"
            style={{ borderColor: "var(--border)" }}
          >
            Cancel
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {usd(buyInCents)} buy-in · you can change your pick until the group stage ends.
      </p>
    </div>
  );
}
