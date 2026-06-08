import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionPlayerId } from "@/lib/session";
import { getDraft, getPlayer, getResults } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { bracketComplete } from "@/lib/bracketState";
import { hasAnyResults } from "@/lib/pickStatus";
import { TopNav } from "@/components/TopNav";
import { BracketView } from "@/components/BracketView";
import { AiAssistedBadge } from "@/components/AiAssistedBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PicksPage() {
  const meId = await getSessionPlayerId();
  if (!meId) redirect("/");
  const player = getPlayer(meId);
  if (!player) redirect("/");

  const { draft, aiAssisted } = getDraft(meId);
  const results = getResults();
  const locked = isLocked();
  const complete = bracketComplete(draft);
  const showStatus = hasAnyResults(results);

  const finalists = draft.rounds.FINAL ?? [];
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
        className="rounded-xl px-4 py-2.5 text-xs text-center flex items-center justify-center gap-2 flex-wrap"
        style={
          locked
            ? { background: "var(--gold-soft)", color: "var(--gold)" }
            : { background: "var(--pitch-soft)", color: "var(--pitch)" }
        }
      >
        <span>
          {locked
            ? "🔒 Brackets are locked — these are your final picks."
            : complete
              ? "✓ Bracket complete — editable until kickoff June 11."
              : "Draft in progress — finish it before kickoff June 11."}
        </span>
        {aiAssisted && <AiAssistedBadge />}
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
        <BracketView draft={draft} results={results} showStatus={showStatus} />
      )}
    </div>
  );
}
