import { GROUP_IDS, TEAMS_BY_ID } from "@/lib/teams";
import { r32Field, type DraftBracket } from "@/lib/bracketState";
import type { Results } from "@/lib/scoring";
import {
  type PickStatus,
  knockoutPickStatus,
  groupAdvanceStatus,
  groupWinnerHit,
  r32PickStatus,
} from "@/lib/pickStatus";
import type { KnockoutRound } from "@/lib/tournament";
import type { SpiritPulse } from "@/lib/analytics";
import { Flag } from "@/components/Flag";
import { SpiritPulseLine } from "@/components/SpiritPulse";

const ORDINAL = ["1st", "2nd", "3rd"];

// Read-only bracket renderer shared by your own /picks and other players'
// /picks/[id]. When `showStatus` is on (results have started landing), each
// pick is overlaid correct (✓) / out (✗); undecided picks stay neutral.
export function BracketView({
  draft,
  results,
  showStatus,
  spiritPulse,
}: {
  draft: DraftBracket;
  results: Results;
  showStatus: boolean;
  /** Heartbreak meter for the spirit team — post-lock only (callers gate). */
  spiritPulse?: SpiritPulse | null;
}) {
  const champion = draft.rounds.CHAMPION?.[0];
  const finalists = draft.rounds.FINAL ?? [];
  const sf = draft.rounds.SF ?? [];
  const qf = draft.rounds.QF ?? [];
  const r16 = draft.rounds.R16 ?? [];
  // R32 isn't an explicit round — it's the 24 group qualifiers + 8 chosen thirds.
  const r32 = r32Field(draft);
  const spirit = draft.spiritTeamId ? TEAMS_BY_ID[draft.spiritTeamId] : null;

  const koStatus = (round: KnockoutRound, id: string) =>
    showStatus ? knockoutPickStatus(results, round, id) : undefined;

  return (
    <div className="mt-4 space-y-5">
      {showStatus && <Legend />}

      {/* Knockouts, deepest first */}
      <Section title="Champion">
        {champion ? (
          <TeamRow id={champion} big status={koStatus("CHAMPION", champion)} />
        ) : (
          <Empty />
        )}
      </Section>
      <Section title="Final">
        <TeamList ids={finalists} round="FINAL" results={results} showStatus={showStatus} />
      </Section>
      <Section title="Semifinals">
        <TeamList ids={sf} round="SF" results={results} showStatus={showStatus} />
      </Section>
      <Section title="Quarterfinals">
        <TeamList ids={qf} round="QF" results={results} showStatus={showStatus} />
      </Section>
      <Section title="Round of 16">
        <TeamList ids={r16} round="R16" results={results} showStatus={showStatus} />
      </Section>
      <Section title="Round of 32">
        <TeamList ids={r32} round="R32" results={results} showStatus={showStatus} />
      </Section>

      {/* Spirit + tiebreaker */}
      <div className="grid grid-cols-2 gap-3">
        <Section title="Spirit team">
          {spirit ? (
            <>
              <TeamRow id={spirit.id} />
              {spiritPulse && (
                <SpiritPulseLine pulse={spiritPulse} teamName={spirit.name} />
              )}
            </>
          ) : (
            <Empty />
          )}
        </Section>
        <Section title="Final goals (tiebreaker)">
          <span className="text-2xl font-bold tabular-nums">{draft.finalGoals ?? "–"}</span>
        </Section>
      </div>

      {/* Group stage */}
      <div>
        <div className="eyebrow mb-2">Group stage</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {GROUP_IDS.map((g) => {
            const order = draft.groupOrder[g] ?? [];
            return (
              <section key={g} className="card-surface rounded-xl p-3 border border-border">
                <div className="font-bold text-sm mb-2">Group {g}</div>
                <div className="space-y-1.5">
                  {/* In the player's predicted finishing order (1st → 2nd → 3rd),
                      not alphabetical. */}
                  {order.map((id, rank) => {
                    const t = TEAMS_BY_ID[id];
                    if (!t) return null;
                    const wildcard = rank === 2 && draft.bestThirds.includes(id);
                    // Rank 0/1 = advance picks (group result). Rank 2 only scores
                    // if it's a wildcard, via the R32 field. Non-wildcard 3rds
                    // are just a ranking — no overlay.
                    let status: PickStatus | undefined;
                    if (showStatus) {
                      if (rank <= 1) status = groupAdvanceStatus(results, g, id);
                      else if (wildcard) status = r32PickStatus(results, id);
                    }
                    const winner = rank === 0 && showStatus && groupWinnerHit(results, g, id);
                    return (
                      <div key={id} className="flex items-center gap-2 text-sm">
                        <span className="eyebrow w-6">{ORDINAL[rank]}</span>
                        <Flag code={t.flag} />
                        <Name name={t.name} status={status} />
                        {winner && (
                          <span title="Called the group winner (+1)">👑</span>
                        )}
                        {wildcard && (
                          <span
                            className="pick-badge"
                            style={{ background: "var(--wildcard-soft)", color: "var(--wildcard)" }}
                          >
                            wildcard
                          </span>
                        )}
                        <StatusMark status={status} />
                      </div>
                    );
                  })}
                  {order.length === 0 && <Empty />}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
      <span>
        <span style={{ color: "var(--pitch)" }}>✓</span> correct
      </span>
      <span>
        <span style={{ color: "var(--destructive)" }}>✗</span> out
      </span>
      <span>· pending</span>
    </div>
  );
}

function StatusMark({ status }: { status?: PickStatus }) {
  if (status === "correct")
    return <span style={{ color: "var(--pitch)" }} title="correct">✓</span>;
  if (status === "missed")
    return <span style={{ color: "var(--destructive)" }} title="out">✗</span>;
  return null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-surface rounded-xl p-3 border border-border">
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </section>
  );
}

function TeamList({
  ids,
  round,
  results,
  showStatus,
}: {
  ids: string[];
  round: KnockoutRound;
  results: Results;
  showStatus: boolean;
}) {
  if (!ids.length) return <Empty />;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {ids.map((id) => (
        <TeamRow
          key={id}
          id={id}
          status={showStatus ? knockoutPickStatus(results, round, id) : undefined}
        />
      ))}
    </div>
  );
}

function TeamRow({ id, big, status }: { id: string; big?: boolean; status?: PickStatus }) {
  const t = TEAMS_BY_ID[id];
  if (!t) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Flag code={t.flag} lg={big} />
      <Name name={t.name} status={status} big={big} />
      <StatusMark status={status} />
    </span>
  );
}

function Name({ name, status, big }: { name: string; status?: PickStatus; big?: boolean }) {
  const base = big ? "font-bold text-lg" : "font-medium text-sm";
  const missed = status === "missed";
  return (
    <span
      className={base}
      style={missed ? { textDecoration: "line-through", color: "var(--muted-foreground)" } : undefined}
    >
      {name}
    </span>
  );
}

function Empty() {
  return <span className="text-muted-foreground text-sm">—</span>;
}
