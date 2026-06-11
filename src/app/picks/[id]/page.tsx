import { redirect } from "next/navigation";
import { getSessionPlayerId } from "@/lib/session";
import { getDraft, getPlayer, getResults } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { hasAnyResults } from "@/lib/pickStatus";
import { currentRooting, getOdds } from "@/lib/odds";
import { spiritPulse } from "@/lib/analytics";
import { TopNav } from "@/components/TopNav";
import { BracketView } from "@/components/BracketView";
import { AiAssistedBadge } from "@/components/AiAssistedBadge";
import { OddsCard } from "@/components/OddsCard";
import { RootingCard } from "@/components/RootingCard";

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
  const firstName = target.name.split(" ")[0];

  // This page only renders post-lock (gate above), so odds always show here
  // once the cron has cached a snapshot.
  const odds = getOdds();
  const theirOdds = odds?.entries.find((e) => e.id === id);
  const rooting = currentRooting(odds?.rooting ?? []);
  const pulse =
    odds && draft.spiritTeamId ? spiritPulse(draft.spiritTeamId, odds.teams, results) : null;

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <TopNav context={`${firstName}'s bracket`} />

      <div
        className="rounded-xl px-4 py-2.5 text-xs text-center flex items-center justify-center gap-2 flex-wrap"
        style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
      >
        <span>🔒 {firstName}&apos;s final picks</span>
        {aiAssisted && <AiAssistedBadge />}
      </div>

      {odds && theirOdds && (
        <OddsCard
          entry={theirOdds}
          sims={odds.sims}
          whose={`${firstName}'s odds`}
        />
      )}
      {/* The scouting report: same conditional buckets, their bracket's
          rooting interest instead of yours. */}
      {odds && theirOdds && rooting.games.length > 0 && (
        <RootingCard
          games={rooting.games}
          laterGames={rooting.laterGames}
          meId={id}
          baselineWin={theirOdds.winProb}
          spiritTeamId={draft.spiritTeamId}
          whose={firstName}
        />
      )}
      <BracketView
        draft={draft}
        results={results}
        showStatus={showStatus}
        spiritPulse={pulse}
      />
    </div>
  );
}
