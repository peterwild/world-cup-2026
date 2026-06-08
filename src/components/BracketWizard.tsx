"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Player } from "@/lib/repo";
import { Flag } from "./Flag";
import { PoolTeaser } from "./PoolTeaser";
import {
  GROUP_IDS,
  TEAMS,
  TEAMS_BY_ID,
  teamsInGroup,
  type GroupId,
} from "@/lib/teams";
import {
  GROUP_ADVANCE_POINTS,
  GROUP_WINNER_BONUS,
  ROUND_POINTS,
  ROUND_SIZE,
  type KnockoutRound,
} from "@/lib/tournament";
import {
  bracketComplete,
  cascadeTrim,
  emptyDraft,
  groupsComplete,
  loadDraft,
  poolForRound,
  r32Field,
  roundComplete,
  saveDraft,
  thirdPlaceTeams,
  thirdsComplete,
  type DraftBracket,
} from "@/lib/bracketState";

type Step =
  | { kind: "intro" }
  | { kind: "groups" }
  | { kind: "thirds" }
  | { kind: "round"; round: KnockoutRound }
  | { kind: "spirit" }
  | { kind: "tiebreaker" }
  | { kind: "review" }
  | { kind: "done" };

const KO_STEPS: KnockoutRound[] = ["R16", "QF", "SF", "FINAL", "CHAMPION"];

const ROUND_LABEL: Record<KnockoutRound, string> = {
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarterfinals",
  SF: "Semifinals",
  FINAL: "Final",
  CHAMPION: "Champion",
};

const STEPS: Step[] = [
  { kind: "intro" },
  { kind: "groups" },
  { kind: "thirds" },
  ...KO_STEPS.map((round) => ({ kind: "round", round }) as Step),
  { kind: "spirit" },
  { kind: "tiebreaker" },
  { kind: "review" },
  { kind: "done" },
];

const ORDINAL = ["1st", "2nd", "3rd", "4th"];

export function BracketWizard({ player }: { player: Player }) {
  const [draft, setDraftState] = useState<DraftBracket>(emptyDraft);
  const [stepIdx, setStepIdx] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [locked, setLocked] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load this player's saved bracket from the server (fall back to any local
  // draft if the server has none / is unreachable), then keep both in sync.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const local = loadDraft();
      try {
        const res = await fetch("/api/bracket");
        if (res.ok && !cancelled) {
          const d = await res.json();
          const server = d.draft as DraftBracket;
          const serverHasPicks =
            Object.values(server.groupOrder).some((a) => a.length) ||
            !!server.spiritTeamId;
          setDraftState(cascadeTrim(serverHasPicks ? server : local));
          setLocked(!!d.locked);
        } else if (!cancelled) {
          setDraftState(local);
        }
      } catch {
        if (!cancelled) setDraftState(local);
      } finally {
        if (!cancelled) {
          setHydrated(true);
          // Deep-link from AI Mode's "Accept": jump straight to the review screen
          // with the just-saved picks pre-filled.
          if (new URLSearchParams(window.location.search).get("step") === "review") {
            jumpTo("review", setStepIdx);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function scheduleServerSave(next: DraftBracket) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: next }),
      })
        .then((r) => {
          if (r.status === 423) setLocked(true);
        })
        .catch(() => {});
    }, 700);
  }

  function setDraft(updater: (d: DraftBracket) => DraftBracket) {
    setDraftState((prev) => {
      const next = cascadeTrim(updater(prev));
      saveDraft(next); // local backup
      if (!locked) scheduleServerSave(next);
      return next;
    });
  }

  async function lockIn() {
    try {
      const res = await fetch("/api/bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, submit: true }),
      });
      if (res.status === 423) {
        setLocked(true);
        return;
      }
    } catch {
      /* still advance — local + last autosave hold the picks */
    }
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }

  const step = STEPS[stepIdx];

  const canAdvance = useMemo(() => {
    switch (step.kind) {
      case "groups":
        return groupsComplete(draft);
      case "thirds":
        return thirdsComplete(draft);
      case "round":
        return roundComplete(draft, step.round);
      case "spirit":
        return !!draft.spiritTeamId;
      case "tiebreaker":
        return draft.finalGoals !== null;
      case "review":
        return bracketComplete(draft);
      default:
        return true;
    }
  }, [step, draft]);

  // A short hint shown in the footer while the step isn't complete, so it's
  // always obvious WHY Next is disabled (and that more scrolling is needed).
  const gate = useMemo(() => {
    switch (step.kind) {
      case "groups": {
        const done = GROUP_IDS.filter((g) => draft.groupOrder[g].length >= 3).length;
        return done < 12 ? `Rank all 12 groups to continue — ${done}/12 done` : null;
      }
      case "thirds":
        return draft.bestThirds.length < 8
          ? `Pick your 8 wildcards — ${draft.bestThirds.length}/8`
          : null;
      case "round": {
        const need = ROUND_SIZE[step.round];
        const picked = draft.rounds[step.round]?.length ?? 0;
        return picked < need ? `Pick ${need} — ${picked}/${need} chosen` : null;
      }
      case "spirit":
        return draft.spiritTeamId ? null : "Pick your spirit team to continue";
      case "tiebreaker":
        return draft.finalGoals === null ? "Set your tiebreaker to continue" : null;
      case "review":
        return bracketComplete(draft) ? null : "Finish every section to lock in";
      default:
        return null;
    }
  }, [step, draft]);

  // Progress: count meaningful steps (exclude intro + done).
  const total = STEPS.length - 2;
  const progress = Math.min(Math.max(stepIdx, 0), total);

  function next() {
    setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
  }
  function back() {
    setStepIdx((i) => Math.max(i - 1, 0));
  }

  if (!hydrated) {
    return <div className="min-h-dvh bg-background" />;
  }

  const chrome = step.kind !== "intro" && step.kind !== "done";

  return (
    // Fixed-height app shell: header + footer are pinned (shrink-0), only <main>
    // scrolls. This guarantees Next is always on screen — sticky-bottom doesn't
    // pin to the viewport when it's the last element in document flow.
    <div className="h-dvh flex flex-col max-w-xl mx-auto overflow-hidden">
      {chrome && (
        <Header
          progress={progress}
          total={total}
          step={step}
          playerName={player.name}
          onHome={() => setStepIdx(0)}
        />
      )}
      {chrome && locked && (
        <div
          className="px-4 py-2 text-center text-xs shrink-0"
          style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
        >
          🔒 Brackets are locked — viewing only.
        </div>
      )}

      <main className={`flex-1 min-h-0 overflow-y-auto ${chrome ? "px-4 pb-6" : ""}`}>
        {step.kind === "intro" && <Intro onStart={next} />}
        {step.kind === "groups" && <GroupsStep draft={draft} setDraft={setDraft} />}
        {step.kind === "thirds" && <ThirdsStep draft={draft} setDraft={setDraft} />}
        {step.kind === "round" && (
          <RoundStep draft={draft} setDraft={setDraft} round={step.round} />
        )}
        {step.kind === "spirit" && <SpiritStep draft={draft} setDraft={setDraft} />}
        {step.kind === "tiebreaker" && (
          <TiebreakerStep draft={draft} setDraft={setDraft} />
        )}
        {step.kind === "review" && (
          <ReviewStep draft={draft} goto={(k) => jumpTo(k, setStepIdx)} />
        )}
        {step.kind === "done" && (
          <DoneStep draft={draft} onEdit={() => jumpTo("review", setStepIdx)} />
        )}
      </main>

      {chrome && (
        <footer className="wizard-footer shrink-0">
          <div className="max-w-xl mx-auto">
            {gate && (
              <p className="text-center text-xs text-muted-foreground mb-2">{gate}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={back}
                className="px-5 py-3 rounded-xl border border-border text-sm font-medium text-muted-foreground active:scale-[0.98] transition"
              >
                Back
              </button>
              <button
                onClick={step.kind === "review" ? lockIn : next}
                disabled={!canAdvance}
                className="flex-1 px-5 py-3 rounded-xl text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: "var(--pitch)", color: "white" }}
              >
                {step.kind === "review" ? "Lock it in" : "Next"}
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function jumpTo(kind: Step["kind"], setStepIdx: (n: number) => void) {
  const i = STEPS.findIndex((s) => s.kind === kind);
  if (i >= 0) setStepIdx(i);
}

// ── Header / progress ────────────────────────────────────────────────────────

function Header({
  progress,
  total,
  step,
  playerName,
  onHome,
}: {
  progress: number;
  total: number;
  step: Step;
  playerName: string;
  onHome: () => void;
}) {
  const title =
    step.kind === "groups"
      ? "Group Stage"
      : step.kind === "thirds"
        ? "Best 3rd-Place Teams"
        : step.kind === "round"
          ? ROUND_LABEL[step.round]
          : step.kind === "spirit"
            ? "Spirit Team"
            : step.kind === "tiebreaker"
              ? "Tiebreaker"
              : "Review";
  return (
    <header className="px-4 pt-5 pb-3 shrink-0 border-b border-border">
      <div className="flex items-center justify-between gap-3 pr-14">
        <button onClick={onHome} className="eyebrow underline whitespace-nowrap shrink-0">
          ⌂ Home
        </button>
        <span className="eyebrow truncate min-w-0 flex-1 text-center">
          Step {progress} / {total} · {playerName.split(" ")[0]}
        </span>
        <a href="/leaderboard" className="eyebrow underline whitespace-nowrap shrink-0">
          🏆 Leaderboard
        </a>
      </div>
      <h1 className="text-2xl font-bold mt-1">{title}</h1>
      <div className="h-1 mt-3 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${(progress / total) * 100}%`, background: "var(--pitch)" }}
        />
      </div>
    </header>
  );
}

// ── Intro ────────────────────────────────────────────────────────────────────

function Intro({ onStart }: { onStart: () => void }) {
  const [showScoring, setShowScoring] = useState(false);
  return (
    <div className="min-h-full flex flex-col items-center justify-center text-center gap-6 px-4 py-10">
      <div className="text-5xl">🏆 ⚽️ 🍽️</div>
      <div>
        <p className="eyebrow">Kitchen Table pool</p>
        <h1 className="text-4xl font-extrabold tracking-tight mt-1">
          World Cup 2026
        </h1>
        <p className="text-muted-foreground mt-3 max-w-sm">
          Pick all 48 teams through the bracket, choose a spirit team, and watch
          your bracket update live as games are played. Buy-in pays out to the top
          3: 60% / 30% / 10%.
        </p>
      </div>
      <PoolTeaser />
      <button
        onClick={onStart}
        className="px-7 py-3.5 rounded-xl text-base font-semibold active:scale-[0.98] transition"
        style={{ background: "var(--pitch)", color: "white" }}
      >
        Start your bracket
      </button>
      <div className="flex flex-col items-center gap-3">
        <a
          href="/ai"
          className="text-sm flex items-center gap-2 px-4 py-2 rounded-full border active:scale-[0.98] transition"
          style={{ borderColor: "var(--pitch)", color: "var(--pitch)" }}
        >
          <span className="text-base">✨</span> Build it with AI
        </a>
        <div className="flex items-center gap-4">
          <a href="/picks" className="text-sm text-muted-foreground underline">
            View my picks
          </a>
          <a href="/leaderboard" className="text-sm text-muted-foreground underline">
            🏆 Leaderboard
          </a>
        </div>
        <button
          onClick={() => setShowScoring((s) => !s)}
          className="text-sm text-muted-foreground underline"
        >
          How scoring works {showScoring ? "▴" : "▾"}
        </button>
      </div>
      {showScoring && <ScoringExplainer />}
    </div>
  );
}

function ScoringExplainer() {
  return (
    <div className="card-surface rounded-xl border border-border p-4 text-left max-w-sm text-sm space-y-3">
      <p className="text-muted-foreground">
        You predict <b>which teams reach each stage</b>, not individual matchups.
        Points add up as your teams go deeper.
      </p>
      <div>
        <div className="eyebrow mb-1">Group stage</div>
        <p className="text-muted-foreground">
          +{GROUP_ADVANCE_POINTS} for each team you correctly pick to finish top 2
          of its group, +{GROUP_WINNER_BONUS} bonus for the group winner.
        </p>
      </div>
      <div>
        <div className="eyebrow mb-1">Knockouts</div>
        <p className="text-muted-foreground">
          Points for every team that reaches a round, rising each round:
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
          <span>Round of 16: {ROUND_POINTS.R16}</span>
          <span>Quarterfinal: {ROUND_POINTS.QF}</span>
          <span>Semifinal: {ROUND_POINTS.SF}</span>
          <span>Final: {ROUND_POINTS.FINAL}</span>
          <span>Champion: {ROUND_POINTS.CHAMPION}</span>
        </div>
      </div>
      <p className="text-muted-foreground">
        <b>Tiebreaker:</b> total goals in the final. <b>Spirit team:</b> just for fun.
      </p>
    </div>
  );
}

// ── Group stage ──────────────────────────────────────────────────────────────

function GroupsStep({
  draft,
  setDraft,
}: {
  draft: DraftBracket;
  setDraft: (u: (d: DraftBracket) => DraftBracket) => void;
}) {
  return (
    <div className="space-y-4 mt-2">
      <p className="text-sm text-muted-foreground">
        Tap teams in their predicted finishing order — 1st, 2nd, 3rd. Top 2
        advance; 3rd-place teams compete for the wildcard spots next.
      </p>
      {GROUP_IDS.map((g) => (
        <GroupCard key={g} group={g} draft={draft} setDraft={setDraft} />
      ))}
    </div>
  );
}

function GroupCard({
  group,
  draft,
  setDraft,
}: {
  group: GroupId;
  draft: DraftBracket;
  setDraft: (u: (d: DraftBracket) => DraftBracket) => void;
}) {
  const order = draft.groupOrder[group];
  const teams = teamsInGroup(group);

  function tap(teamId: string) {
    setDraft((d) => {
      const cur = d.groupOrder[group];
      const at = cur.indexOf(teamId);
      let nextOrder: string[];
      if (at >= 0) {
        nextOrder = cur.slice(0, at); // clear this rank + everything after
      } else if (cur.length < 3) {
        nextOrder = [...cur, teamId];
      } else {
        nextOrder = cur; // already have top 3
      }
      return { ...d, groupOrder: { ...d.groupOrder, [group]: nextOrder } };
    });
  }

  const complete = order.length >= 3;

  return (
    <section className="card-surface rounded-xl p-3 border border-border">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 className="font-bold text-sm">
          Group {group}
        </h2>
        {complete ? (
          <span className="text-xs" style={{ color: "var(--pitch)" }}>
            ✓ set
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            {order.length}/3
          </span>
        )}
      </div>
      <div className="space-y-2">
        {teams.map((t) => {
          const rank = order.indexOf(t.id);
          const isImpliedLast = complete && rank === -1;
          // 1st = winner (gold), 2nd = advances (green), 3rd = wildcard (indigo)
          const state = rank === 0 ? "winner" : rank === 1 ? "second" : rank === 2 ? "third" : undefined;
          const tone =
            rank === 0
              ? { background: "var(--gold-soft)", color: "var(--gold)" }
              : rank === 1
                ? { background: "var(--pitch-soft)", color: "var(--pitch)" }
                : { background: "var(--wildcard-soft)", color: "var(--wildcard)" };
          return (
            <button
              key={t.id}
              className="team-row"
              data-picked={state}
              data-eliminated={isImpliedLast ? "1" : undefined}
              onClick={() => tap(t.id)}
            >
              <Flag code={t.flag} />
              <span className="font-medium text-sm">{t.name}</span>
              {rank >= 0 && (
                <span className="pick-badge" style={tone}>
                  {ORDINAL[rank]}
                  {rank === 2 ? " · wildcard?" : ""}
                </span>
              )}
              {isImpliedLast && (
                <span className="pick-badge bg-muted text-muted-foreground">4th</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ── Best thirds ──────────────────────────────────────────────────────────────

function ThirdsStep({
  draft,
  setDraft,
}: {
  draft: DraftBracket;
  setDraft: (u: (d: DraftBracket) => DraftBracket) => void;
}) {
  const pool = thirdPlaceTeams(draft);
  const picked = draft.bestThirds;

  function toggle(id: string) {
    setDraft((d) => {
      const has = d.bestThirds.includes(id);
      if (has) return { ...d, bestThirds: d.bestThirds.filter((x) => x !== id) };
      if (d.bestThirds.length >= 8) return d;
      return { ...d, bestThirds: [...d.bestThirds, id] };
    });
  }

  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground mb-3">
        Eight of the twelve 3rd-place teams advance to the Round of 32. Pick the{" "}
        <b>{picked.length}/8</b> you think sneak through.
      </p>
      <div className="space-y-2">
        {pool.map((id) => {
          const t = TEAMS_BY_ID[id];
          const on = picked.includes(id);
          return (
            <button
              key={id}
              className="team-row"
              data-picked={on ? "1" : undefined}
              onClick={() => toggle(id)}
            >
              <Flag code={t.flag} />
              <span className="font-medium text-sm">{t.name}</span>
              <span className="text-xs text-muted-foreground ml-1">
                Grp {t.group}
              </span>
              {on && (
                <span
                  className="pick-badge"
                  style={{ background: "var(--pitch-soft)", color: "var(--pitch)" }}
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Knockout round ───────────────────────────────────────────────────────────

function RoundStep({
  draft,
  setDraft,
  round,
}: {
  draft: DraftBracket;
  setDraft: (u: (d: DraftBracket) => DraftBracket) => void;
  round: KnockoutRound;
}) {
  const pool = useMemo(
    () =>
      [...poolForRound(draft, round)]
        .map((id) => TEAMS_BY_ID[id])
        .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name)),
    [draft, round],
  );
  const picked = draft.rounds[round] ?? [];
  const need = ROUND_SIZE[round];
  const single = need === 1;

  function toggle(id: string) {
    setDraft((d) => {
      const cur = d.rounds[round] ?? [];
      if (single) return { ...d, rounds: { ...d.rounds, [round]: [id] } };
      const has = cur.includes(id);
      if (has) return { ...d, rounds: { ...d.rounds, [round]: cur.filter((x) => x !== id) } };
      if (cur.length >= need) return d;
      return { ...d, rounds: { ...d.rounds, [round]: [...cur, id] } };
    });
  }

  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground mb-3">
        {single ? (
          <>Tap your champion. <b>{picked.length}/1</b></>
        ) : (
          <>
            Pick the <b>{need}</b> teams that reach the {ROUND_LABEL[round]}.{" "}
            <b>
              {picked.length}/{need}
            </b>
          </>
        )}
      </p>
      <div className="space-y-2">
        {pool.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              className="team-row"
              data-picked={on ? (single ? "winner" : "1") : undefined}
              onClick={() => toggle(t.id)}
            >
              <Flag code={t.flag} lg={single} />
              <span className="font-medium text-sm">{t.name}</span>
              <span className="text-xs text-muted-foreground ml-1">Grp {t.group}</span>
              {on && (
                <span
                  className="pick-badge"
                  style={{
                    background: single ? "var(--gold-soft)" : "var(--pitch-soft)",
                    color: single ? "var(--gold)" : "var(--pitch)",
                  }}
                >
                  {single ? "🏆" : "✓"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Spirit team ──────────────────────────────────────────────────────────────

function SpiritStep({
  draft,
  setDraft,
}: {
  draft: DraftBracket;
  setDraft: (u: (d: DraftBracket) => DraftBracket) => void;
}) {
  const teams = useMemo(
    () => [...TEAMS].sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  return (
    <div className="mt-2">
      <p className="text-sm text-muted-foreground mb-3">
        Your ride-or-die. No money rides on it — but if your spirit team wins the
        whole thing, you get a <b>Spirit Champion</b> trophy and eternal bragging
        rights. Pick one.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {teams.map((t) => {
          const on = draft.spiritTeamId === t.id;
          return (
            <button
              key={t.id}
              className="team-row"
              data-picked={on ? "winner" : undefined}
              onClick={() =>
                setDraft((d) => ({ ...d, spiritTeamId: on ? null : t.id }))
              }
            >
              <Flag code={t.flag} />
              <span className="font-medium text-xs">{t.name}</span>
              {on && <span className="pick-badge">❤️</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Tiebreaker ───────────────────────────────────────────────────────────────

function TiebreakerStep({
  draft,
  setDraft,
}: {
  draft: DraftBracket;
  setDraft: (u: (d: DraftBracket) => DraftBracket) => void;
}) {
  const val = draft.finalGoals;
  function set(n: number) {
    const clamped = Math.max(0, Math.min(12, n));
    setDraft((d) => ({ ...d, finalGoals: clamped }));
  }
  return (
    <div className="mt-2 flex flex-col items-center text-center gap-6 pt-6">
      <p className="text-sm text-muted-foreground max-w-sm">
        Total goals scored in the Final (both teams combined). We use this to break
        ties on the leaderboard.
      </p>
      <div className="flex items-center gap-5">
        <button
          onClick={() => set((val ?? 0) - 1)}
          className="w-14 h-14 rounded-full border border-border text-2xl active:scale-95 transition"
        >
          −
        </button>
        <div className="w-24 text-center">
          <div className="text-5xl font-extrabold tabular-nums">{val ?? "–"}</div>
          <div className="eyebrow mt-1">goals</div>
        </div>
        <button
          onClick={() => set((val ?? 0) + 1)}
          className="w-14 h-14 rounded-full border border-border text-2xl active:scale-95 transition"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ── Review ───────────────────────────────────────────────────────────────────

function ReviewStep({
  draft,
  goto,
}: {
  draft: DraftBracket;
  goto: (k: Step["kind"]) => void;
}) {
  const champion = draft.rounds.CHAMPION?.[0];
  const finalists = draft.rounds.FINAL ?? [];
  const spirit = draft.spiritTeamId ? TEAMS_BY_ID[draft.spiritTeamId] : null;
  const r32 = r32Field(draft);

  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm text-muted-foreground">
        Here&apos;s your bracket. Tap any section to edit. Locking submits it (you
        can still change it until brackets close at kickoff).
      </p>

      <ReviewCard label="Champion" onEdit={() => goto("round")}>
        {champion ? (
          <TeamInline id={champion} big />
        ) : (
          <span className="text-destructive text-sm">Not picked</span>
        )}
      </ReviewCard>

      <ReviewCard label="Finalists" onEdit={() => goto("round")}>
        <div className="flex flex-wrap gap-2">
          {finalists.map((id) => (
            <TeamInline key={id} id={id} />
          ))}
        </div>
      </ReviewCard>

      <ReviewCard label="Spirit Team" onEdit={() => goto("spirit")}>
        {spirit ? <TeamInline id={spirit.id} /> : <span className="text-destructive text-sm">—</span>}
      </ReviewCard>

      <div className="grid grid-cols-2 gap-3">
        <ReviewCard label="R32 field" onEdit={() => goto("groups")}>
          <span className="text-2xl font-bold tabular-nums">{r32.length}</span>
          <span className="text-sm text-muted-foreground"> / 32 teams</span>
        </ReviewCard>
        <ReviewCard label="Final goals" onEdit={() => goto("tiebreaker")}>
          <span className="text-2xl font-bold tabular-nums">
            {draft.finalGoals ?? "–"}
          </span>
        </ReviewCard>
      </div>
    </div>
  );
}

function ReviewCard({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="card-surface rounded-xl p-3 border border-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="eyebrow">{label}</span>
        <button onClick={onEdit} className="text-xs text-muted-foreground underline">
          edit
        </button>
      </div>
      {children}
    </section>
  );
}

function TeamInline({ id, big }: { id: string; big?: boolean }) {
  const t = TEAMS_BY_ID[id];
  if (!t) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Flag code={t.flag} lg={big} />
      <span className={big ? "font-bold text-lg" : "font-medium text-sm"}>{t.name}</span>
    </span>
  );
}

// ── Done ─────────────────────────────────────────────────────────────────────

function DoneStep({ draft, onEdit }: { draft: DraftBracket; onEdit: () => void }) {
  const champion = draft.rounds.CHAMPION?.[0];
  const t = champion ? TEAMS_BY_ID[champion] : null;
  return (
    <div className="h-full flex flex-col items-center justify-center text-center gap-5 px-4">
      <div className="text-6xl">✅</div>
      <h1 className="text-3xl font-extrabold">You&apos;re in the pool</h1>
      <p className="text-muted-foreground max-w-sm">
        Your bracket is saved. You can keep editing it right up until kickoff on
        June 11. After that it locks.
      </p>
      {t && (
        <div className="card-surface rounded-xl p-4 border border-border flex items-center gap-3">
          <Flag code={t.flag} lg />
          <div className="text-left">
            <div className="eyebrow">Your champion</div>
            <div className="font-bold text-lg">{t.name}</div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <a
          href="/leaderboard"
          className="px-6 py-3 rounded-xl text-sm font-semibold active:scale-[0.98] transition"
          style={{ background: "var(--pitch)", color: "white" }}
        >
          View the leaderboard →
        </a>
        <button
          onClick={onEdit}
          className="px-6 py-3 rounded-xl text-sm font-medium border border-border text-muted-foreground active:scale-[0.98] transition"
        >
          Edit my picks
        </button>
      </div>
    </div>
  );
}
