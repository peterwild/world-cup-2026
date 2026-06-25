import { redirect } from "next/navigation";
import { getSessionPlayerId } from "@/lib/session";
import { getDraft, getPlayer, getResults } from "@/lib/repo";
import { isLocked } from "@/lib/db";
import { hasAnyResults } from "@/lib/pickStatus";
import { currentRooting, getOdds } from "@/lib/odds";
import { backingDepth } from "@/lib/bracketState";
import { pointsRank, spiritPulse } from "@/lib/analytics";
import { getMatchFeed } from "@/lib/matches";
import { allGroupTables } from "@/lib/groupTables";
import { assembleBracket } from "@/lib/knockoutBracket";
import { firstR32Kickoff } from "@/lib/goldenBoot";
import { TopNav } from "@/components/TopNav";
import { PicksDisplay } from "@/components/PicksDisplay";
import { AiAssistedBadge } from "@/components/AiAssistedBadge";
import { OddsCard } from "@/components/OddsCard";
import { RootingCard } from "@/components/RootingCard";
import { LiveStrip } from "@/components/LiveStrip";

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
  // Their bracket's backing — drives "who they should root for" everywhere on
  // this scouting page (live strip + upcoming card), same as my own pages.
  const theirBack = backingDepth(draft);
  const pulse =
    odds && draft.spiritTeamId ? spiritPulse(draft.spiritTeamId, odds.teams, results) : null;

  // Live group tables + the real knockout bracket — same as the own-picks page,
  // assembled against THIS player's draft so their bracket/path views render.
  const feed = getMatchFeed();
  const groupTables = allGroupTables(feed?.played ?? []);
  const bracket = assembleBracket(feed?.knockout ?? [], results, draft);
  const firstKickoffISO = firstR32Kickoff(feed ?? null);

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
          delta={odds.deltas?.[id]}
          rank={pointsRank(odds.entries, id)}
          computedAt={odds.computedAt}
          possessive={`${firstName}'s`}
        />
      )}
      {/* Live & today's games, scouted from their bracket — so you can see who
          they're pulling for right now, not just upcoming. */}
      <LiveStrip back={theirBack} spiritTeamId={draft.spiritTeamId} whose={firstName} />

      {/* The scouting report: who THEIR bracket says to root for in upcoming
          games. Read off their picks, never pool math. */}
      {rooting.games.length > 0 && (
        <RootingCard
          games={rooting.games}
          laterGames={rooting.laterGames}
          back={theirBack}
          spiritTeamId={draft.spiritTeamId}
          whose={firstName}
        />
      )}
      <PicksDisplay
        draft={draft}
        results={results}
        showStatus={showStatus}
        spiritPulse={pulse}
        groupTables={groupTables}
        bracket={bracket}
        firstKickoffISO={firstKickoffISO}
        possessive={`${firstName}'s`}
      />
    </div>
  );
}
