"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flag } from "./Flag";
import { TEAMS_BY_ID } from "@/lib/teams";
import { MODELS, MODEL_KEYS, type ModelKey } from "@/lib/aiBudget";
import type { DraftBracket } from "@/lib/bracketState";

// Rough "how far does $50 go" guidance for the picker — the strategic squeeze.
const TURN_ESTIMATE: Record<ModelKey, string> = {
  opus: "~10 deep turns",
  sonnet: "~30 turns",
  haiku: "~90 turns",
};

interface Bubble {
  role: "user" | "assistant";
  text: string;
  costCents?: number;
}

interface Budget {
  spendCents: number;
  budgetCents: number;
  remainingCents: number;
  overBudget: boolean;
}

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export function AiChat() {
  const [phase, setPhase] = useState<"loading" | "pick" | "chat">("loading");
  const [model, setModel] = useState<ModelKey | null>(null);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [proposal, setProposal] = useState<DraftBracket | null>(null);
  const [budget, setBudget] = useState<Budget>({
    spendCents: 0,
    budgetCents: 5000,
    remainingCents: 5000,
    overBudget: false,
  });
  const [locked, setLocked] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoFinalFired = useRef(false);

  // Load any in-progress session (resume), or show the model picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ai/state");
        if (res.status === 401) {
          window.location.href = "/";
          return;
        }
        const d = await res.json();
        setModel(d.model ?? null);
        setMessages(d.messages ?? []);
        setProposal(d.proposal ?? null);
        setLocked(!!d.locked);
        setBudget({
          spendCents: d.spendCents ?? 0,
          budgetCents: d.budgetCents ?? 5000,
          remainingCents: d.remainingCents ?? 5000,
          overBudget: !!d.overBudget,
        });
        setPhase(d.model ? "chat" : "pick");
      } catch {
        setError("Couldn't load AI Mode. Try again.");
        setPhase("pick");
      }
    })();
  }, []);

  // Auto-pull the forced final bracket when the budget is spent and none exists.
  useEffect(() => {
    if (
      phase === "chat" &&
      budget.overBudget &&
      !proposal &&
      !locked &&
      !streaming &&
      !autoFinalFired.current
    ) {
      autoFinalFired.current = true;
      void send("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, budget.overBudget, proposal, locked, streaming]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function pickModel(m: ModelKey) {
    setError(null);
    try {
      const res = await fetch("/api/ai/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Couldn't set model.");
        return;
      }
      setModel(m);
      setPhase("chat");
    } catch {
      setError("Network error.");
    }
  }

  async function send(text: string) {
    if (streaming || locked) return;
    const isFinal = budget.overBudget;
    if (!isFinal && !text.trim()) return;

    setError(null);
    setStreaming(true);
    if (text.trim()) setMessages((m) => [...m, { role: "user", text: text.trim() }]);
    setInput("");
    // Placeholder assistant bubble we stream into.
    setMessages((m) => [...m, { role: "assistant", text: "" }]);

    const appendToLast = (chunk: string) =>
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          ...copy[copy.length - 1],
          text: copy[copy.length - 1].text + chunk,
        };
        return copy;
      });

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("ndjson")) {
        // Error, or the over-budget short-circuit (200 JSON with the final proposal).
        const d = await res.json().catch(() => ({}));
        if (d.proposal) setProposal(d.proposal);
        if (typeof d.spentCents === "number") {
          setBudget({
            spendCents: d.spentCents,
            budgetCents: d.budgetCents ?? budget.budgetCents,
            remainingCents: d.remainingCents ?? 0,
            overBudget: true,
          });
        }
        if (!res.ok) setError(d.error ?? "AI error.");
        if (d.message) appendToLast(d.message);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let lastCost: number | undefined;
      let gotText = false;
      let gotProposal = false;

      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          return;
        }
        if (ev.type === "text") {
          gotText = true;
          appendToLast(ev.text as string);
        } else if (ev.type === "proposal") {
          gotProposal = true;
          setProposal(ev.proposal as DraftBracket);
          setShowPreview(true);
        } else if (ev.type === "error") {
          setError(ev.error as string);
        } else if (ev.type === "done") {
          lastCost = ev.costCents as number;
          setBudget({
            spendCents: ev.spentCents as number,
            budgetCents: ev.budgetCents as number,
            remainingCents: ev.remainingCents as number,
            overBudget: !!ev.overBudget,
          });
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) handle(l);
      }
      if (buf) handle(buf);

      // Tag the assistant bubble with its turn cost; give a fallback line if the
      // model only proposed (no prose, e.g. the forced final).
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = {
            ...last,
            text: last.text || (gotProposal ? "Here's your bracket — accept it or tell me what to change." : last.text),
            costCents: lastCost,
          };
        }
        return copy;
      });
      void gotText;
    } catch {
      setError("Connection dropped mid-answer.");
    } finally {
      setStreaming(false);
    }
  }

  async function accept() {
    if (!proposal) return;
    setAccepting(true);
    try {
      const res = await fetch("/api/bracket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: proposal, submit: false }),
      });
      if (res.status === 423) {
        setLocked(true);
        setError("Brackets just locked — can't save.");
        return;
      }
      // Hand off to the wizard's review screen (still fully editable there).
      window.location.href = "/?step=review";
    } catch {
      setError("Couldn't save — try again.");
    } finally {
      setAccepting(false);
    }
  }

  if (phase === "loading") return <div className="h-dvh bg-background" />;

  return (
    <div className="h-dvh flex flex-col max-w-xl mx-auto overflow-hidden">
      <Header budget={budget} model={model} />

      {locked && (
        <div
          className="px-4 py-2 text-center text-xs shrink-0"
          style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
        >
          🔒 Brackets are locked — AI Mode is read-only.
        </div>
      )}

      {phase === "pick" ? (
        <ModelPicker onPick={pickModel} error={error} budgetCents={budget.budgetCents} />
      ) : (
        <>
          <main ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
            {messages.length === 0 && <EmptyState onPick={(s) => send(s)} disabled={streaming || locked} />}
            {messages.map((m, i) => (
              <ChatBubble key={i} bubble={m} streaming={streaming && i === messages.length - 1} />
            ))}
            {error && <p className="text-xs text-destructive text-center">{error}</p>}
          </main>

          {proposal && (
            <PreviewDrawer
              proposal={proposal}
              open={showPreview}
              onToggle={() => setShowPreview((s) => !s)}
            />
          )}

          <footer className="wizard-footer shrink-0">
            <div className="max-w-xl mx-auto space-y-2">
              {proposal && !locked && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setProposal(null)}
                    className="px-4 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground active:scale-[0.98] transition"
                  >
                    Reject
                  </button>
                  <button
                    onClick={accept}
                    disabled={accepting}
                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition disabled:opacity-50"
                    style={{ background: "var(--pitch)", color: "white" }}
                  >
                    {accepting ? "Saving…" : "Accept & edit →"}
                  </button>
                </div>
              )}

              {budget.overBudget ? (
                <p className="text-center text-xs text-muted-foreground">
                  {proposal
                    ? "You're out of budget — accept your final bracket or reject to go manual."
                    : "Out of budget — pulling your final bracket…"}
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={streaming || locked}
                    placeholder={locked ? "Locked" : "Ask the AI…"}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-card border border-border text-sm outline-none focus:border-[var(--pitch)] disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={streaming || locked || !input.trim()}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold active:scale-[0.98] transition disabled:opacity-40"
                    style={{ background: "var(--pitch)", color: "white" }}
                  >
                    {streaming ? "…" : "Send"}
                  </button>
                </form>
              )}
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

// ── Header + budget meter ──────────────────────────────────────────────────────

function Header({ budget, model }: { budget: Budget; model: ModelKey | null }) {
  const frac = Math.max(0, Math.min(1, budget.remainingCents / budget.budgetCents));
  const color = frac > 0.5 ? "var(--pitch)" : frac > 0.2 ? "var(--gold)" : "var(--destructive)";
  return (
    <header className="px-4 pt-5 pb-3 shrink-0 border-b border-border">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="eyebrow underline whitespace-nowrap">
          ← Bracket
        </Link>
        <span className="eyebrow truncate">
          {model ? MODELS[model].label : "Pick a model"}
        </span>
      </div>
      <div className="flex items-baseline justify-between mt-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <span>✨</span> AI Mode
        </h1>
        <span className="text-sm font-semibold tabular-nums" style={{ color }}>
          {fmt(budget.remainingCents)} <span className="text-muted-foreground font-normal">/ {fmt(budget.budgetCents)}</span>
        </span>
      </div>
      <div className="h-1.5 mt-2.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${frac * 100}%`, background: color }} />
      </div>
    </header>
  );
}

// ── Model picker ───────────────────────────────────────────────────────────────

function ModelPicker({
  onPick,
  error,
  budgetCents,
}: {
  onPick: (m: ModelKey) => void;
  error: string | null;
  budgetCents: number;
}) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
      <p className="text-sm text-muted-foreground mb-1">
        You get a <b>{fmt(budgetCents)}</b> AI budget. Every question costs tokens;
        smarter models cost more per turn. Choose wisely.
      </p>
      <p className="eyebrow mb-4">Pick your model — locked once you start</p>
      <div className="space-y-3">
        {MODEL_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => onPick(k)}
            className="w-full text-left card-surface rounded-xl p-4 border border-border active:scale-[0.99] transition"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold">{MODELS[k].label}</span>
              <span className="eyebrow">{TURN_ESTIMATE[k]}</span>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{MODELS[k].blurb}</p>
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive mt-4">{error}</p>}
    </main>
  );
}

// ── Chat bubbles ───────────────────────────────────────────────────────────────

function EmptyState({ onPick, disabled }: { onPick: (s: string) => void; disabled: boolean }) {
  const prompts = [
    "Give me a chalk bracket — favorites all the way.",
    "I want a bold contrarian bracket with a surprise champion.",
    "Who's overrated this year, and who's a sleeper?",
  ];
  return (
    <div className="text-center pt-8 space-y-4">
      <div className="text-4xl">✨</div>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        Tell the AI your strategy and it&apos;ll build a bracket. Accept it to
        pre-fill your picks (you can still edit everything).
      </p>
      <div className="space-y-2 pt-2">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            disabled={disabled}
            className="block w-full text-left text-sm card-surface rounded-xl px-4 py-3 border border-border active:scale-[0.99] transition disabled:opacity-50"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ bubble, streaming }: { bubble: Bubble; streaming: boolean }) {
  const isUser = bubble.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div
          className="rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap leading-relaxed"
          style={
            isUser
              ? { background: "var(--pitch-soft)", color: "var(--foreground)" }
              : { background: "var(--card)", border: "1px solid var(--border)" }
          }
        >
          {bubble.text || (streaming ? "…" : "")}
          {streaming && bubble.text && <span className="opacity-50">▍</span>}
        </div>
        {bubble.costCents != null && (
          <span className="eyebrow px-1">−{fmt(bubble.costCents)}</span>
        )}
      </div>
    </div>
  );
}

// ── Bracket preview drawer ─────────────────────────────────────────────────────

function PreviewDrawer({
  proposal,
  open,
  onToggle,
}: {
  proposal: DraftBracket;
  open: boolean;
  onToggle: () => void;
}) {
  const champ = proposal.rounds.CHAMPION?.[0];
  const finalists = proposal.rounds.FINAL ?? [];
  const sf = proposal.rounds.SF ?? [];
  const spirit = proposal.spiritTeamId;
  const r32 = [
    ...Object.values(proposal.groupOrder).flatMap((a) => a.slice(0, 2)),
    ...proposal.bestThirds,
  ].length;

  return (
    <div className="shrink-0 border-t border-border bg-card">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm"
      >
        <span className="eyebrow">Proposed bracket</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          {champ && <TeamChip id={champ} />}
          <span>{open ? "▾" : "▴"}</span>
        </span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-3 max-h-[40dvh] overflow-y-auto">
          <Row label="Champion">{champ ? <TeamChip id={champ} big /> : <Dash />}</Row>
          <Row label="Final">
            <div className="flex flex-wrap gap-2">
              {finalists.length ? finalists.map((id) => <TeamChip key={id} id={id} />) : <Dash />}
            </div>
          </Row>
          <Row label="Semifinal">
            <div className="flex flex-wrap gap-2">
              {sf.length ? sf.map((id) => <TeamChip key={id} id={id} />) : <Dash />}
            </div>
          </Row>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="R32 field" value={`${r32}/32`} />
            <Mini label="Spirit" value={spirit ? TEAMS_BY_ID[spirit]?.name ?? "—" : "—"} />
            <Mini label="Final goals" value={proposal.finalGoals?.toString() ?? "—"} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="eyebrow shrink-0">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="card-surface rounded-lg border border-border p-2 text-center">
      <div className="eyebrow">{label}</div>
      <div className="text-sm font-semibold truncate">{value}</div>
    </div>
  );
}

function Dash() {
  return <span className="text-muted-foreground text-sm">—</span>;
}

function TeamChip({ id, big }: { id: string; big?: boolean }) {
  const t = TEAMS_BY_ID[id];
  if (!t) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Flag code={t.flag} lg={big} />
      <span className={big ? "font-bold" : "text-sm font-medium"}>{t.name}</span>
    </span>
  );
}
