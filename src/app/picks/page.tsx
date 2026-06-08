import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionPlayerId } from "@/lib/session";
import { getDraft, getPlayer } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { bracketComplete } from "@/lib/bracketState";
import { GROUP_IDS, TEAMS_BY_ID, teamsInGroup } from "@/lib/teams";
import { Flag } from "@/components/Flag";
import { TopNav } from "@/components/TopNav";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDINAL = ["1st", "2nd", "3rd"];

export default async function PicksPage() {
  const meId = await getSessionPlayerId();
  if (!meId) redirect("/");
  const player = getPlayer(meId);
  if (!player) redirect("/");

  const { draft } = getDraft(meId);
  const locked = isLocked();
  const complete = bracketComplete(draft);

  const champion = draft.rounds.CHAMPION?.[0];
  const finalists = draft.rounds.FINAL ?? [];
  const sf = draft.rounds.SF ?? [];
  const qf = draft.rounds.QF ?? [];
  const r16 = draft.rounds.R16 ?? [];
  const spirit = draft.spiritTeamId ? TEAMS_BY_ID[draft.spiritTeamId] : null;

  const empty =
    !Object.values(draft.groupOrder).some((a) => a.length) &&
    !draft.spiritTeamId &&
    finalists.length === 0;

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <TopNav
        current="picks"
        context={`${player.name.split(" ")[0]} · My picks`}
        action={
          !locked ? (
            <Link href="/?step=review" className="eyebrow underline whitespace-nowrap">
              ✏️ Edit
            </Link>
          ) : null
        }
      />

      <div
        className="rounded-xl px-4 py-2.5 text-xs text-center"
        style={
          locked
            ? { background: "var(--gold-soft)", color: "var(--gold)" }
            : { background: "var(--pitch-soft)", color: "var(--pitch)" }
        }
      >
        {locked
          ? "🔒 Brackets are locked — these are your final picks."
          : complete
            ? "✓ Bracket complete — editable until kickoff June 11."
            : "Draft in progress — finish it before kickoff June 11."}
      </div>

      {empty ? (
        <div className="text-center py-16">
          <p className="text-sm text-muted-foreground mb-4">
            You haven&apos;t made any picks yet.
          </p>
          <Link
            href="/"
            className="inline-block px-6 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--pitch)", color: "white" }}
          >
            Build your bracket
          </Link>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {/* Knockouts, deepest first */}
          <Section title="Champion">
            {champion ? <TeamRow id={champion} big /> : <Empty />}
          </Section>
          <Section title="Final">
            <TeamList ids={finalists} />
          </Section>
          <Section title="Semifinals">
            <TeamList ids={sf} />
          </Section>
          <Section title="Quarterfinals">
            <TeamList ids={qf} />
          </Section>
          <Section title="Round of 16">
            <TeamList ids={r16} />
          </Section>

          {/* Spirit + tiebreaker */}
          <div className="grid grid-cols-2 gap-3">
            <Section title="Spirit team">
              {spirit ? <TeamRow id={spirit.id} /> : <Empty />}
            </Section>
            <Section title="Final goals (tiebreaker)">
              <span className="text-2xl font-bold tabular-nums">
                {draft.finalGoals ?? "–"}
              </span>
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
                      {teamsInGroup(g).map((t) => {
                        const rank = order.indexOf(t.id);
                        if (rank < 0) return null;
                        const wildcard = rank === 2 && draft.bestThirds.includes(t.id);
                        return (
                          <div key={t.id} className="flex items-center gap-2 text-sm">
                            <span className="eyebrow w-6">{ORDINAL[rank]}</span>
                            <Flag code={t.flag} />
                            <span className="font-medium">{t.name}</span>
                            {wildcard && (
                              <span
                                className="pick-badge"
                                style={{ background: "var(--wildcard-soft)", color: "var(--wildcard)" }}
                              >
                                wildcard
                              </span>
                            )}
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
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card-surface rounded-xl p-3 border border-border">
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </section>
  );
}

function TeamList({ ids }: { ids: string[] }) {
  if (!ids.length) return <Empty />;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {ids.map((id) => (
        <TeamRow key={id} id={id} />
      ))}
    </div>
  );
}

function TeamRow({ id, big }: { id: string; big?: boolean }) {
  const t = TEAMS_BY_ID[id];
  if (!t) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <Flag code={t.flag} lg={big} />
      <span className={big ? "font-bold text-lg" : "font-medium text-sm"}>{t.name}</span>
    </span>
  );
}

function Empty() {
  return <span className="text-muted-foreground text-sm">—</span>;
}
