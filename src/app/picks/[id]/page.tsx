import { redirect } from "next/navigation";
import { getSessionPlayerId } from "@/lib/session";
import { getDraft, getPlayer, getResults } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { hasAnyResults } from "@/lib/pickStatus";
import { TopNav } from "@/components/TopNav";
import { BracketView } from "@/components/BracketView";
import { AiAssistedBadge } from "@/components/AiAssistedBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only view of ANOTHER player's bracket. Gated on lock: before kickoff,
// other people's picks are hidden (they'd be information used against you).
// The redirect is the real gate — IDs are opaque UUIDs, but a guessed URL
// still bounces until brackets lock.
export default async function PlayerBracketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const meId = await getSessionPlayerId();
  if (!meId) redirect("/");

  const { id } = await params;
  if (id === meId) redirect("/picks"); // canonicalize self → own page
  if (!isLocked()) redirect("/leaderboard"); // HARD GATE — others only post-lock

  const target = getPlayer(id);
  if (!target) redirect("/leaderboard");

  const { draft, aiAssisted } = getDraft(id);
  const results = getResults();
  const showStatus = hasAnyResults(results);

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <TopNav context={`${target.name.split(" ")[0]}'s bracket`} />

      <div
        className="rounded-xl px-4 py-2.5 text-xs text-center flex items-center justify-center gap-2 flex-wrap"
        style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
      >
        <span>🔒 {target.name.split(" ")[0]}&apos;s final picks</span>
        {aiAssisted && <AiAssistedBadge />}
      </div>

      <BracketView draft={draft} results={results} showStatus={showStatus} />
    </div>
  );
}
