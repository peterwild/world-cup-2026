import { redirect } from "next/navigation";
import { getSessionPlayer } from "@/lib/session";
import { getAllGoldenBoot, getAllPlayers, getBuyInCents, getGroupName } from "@/lib/repo";
import {
  getCandidates,
  getGoldenBootBuyInCents,
  getGoldenBootResult,
  getScorers,
  goalsForPick,
} from "@/lib/goldenBoot";
import { TopNav } from "@/components/TopNav";
import { AdminPaidList } from "@/components/AdminPaidList";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin-only buy-in tracker. Who's paid is rendered ONLY after the server
// confirms is_admin, so the paid roster never ships to a non-admin browser.
// Non-admins (and logged-out visitors) are bounced before any of it renders.
export default async function AdminPage() {
  const me = await getSessionPlayer();
  if (!me) redirect("/");
  if (!me.is_admin) redirect("/leaderboard");

  const players = getAllPlayers();
  const poolRows = players.map((p) => ({ id: p.id, name: p.name, paid: p.paid }));

  // Golden Boot is opt-in: only players who opted IN owe the side-bet buy-in,
  // so the tracker lists just them (declined / never-answered don't appear).
  // Surface each player's PICK (+ live goals, + 🏆 if it matches a set winner)
  // so you can eyeball who's leading and verify a winner.
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const candById = new Map(getCandidates().map((c) => [c.id, c]));
  const scorers = getScorers();
  const winnerId = getGoldenBootResult();
  const pickLabel = (pickId: string | null): string => {
    if (!pickId) return "No pick";
    const name = candById.get(pickId)?.name ?? pickId;
    const goals = goalsForPick(scorers, pickId);
    return goals == null ? name : `${name} · ${goals} goal${goals === 1 ? "" : "s"}`;
  };
  const gbRows = getAllGoldenBoot()
    .filter((g) => g.status === "in")
    .map((g) => ({
      id: g.playerId,
      name: nameById.get(g.playerId) ?? g.playerId,
      paid: g.paid,
      sub: pickLabel(g.pickId),
      won: winnerId != null && g.pickId === winnerId,
      // For sorting only: a pick that hasn't scored (null) sits below 0-goal picks.
      goals: goalsForPick(scorers, g.pickId) ?? -1,
    }))
    // Goals desc (leaders on top, easy to eyeball a winner), name A→Z to break ties.
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name));

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <TopNav context={`${getGroupName()} · Admin`} />
      <h1 className="text-xl font-extrabold mt-2">Buy-in tracker</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Only you can see this. Tap a name to flip whether they&apos;ve paid. Tap
        Delete twice to confirm: in the pool it removes the whole account
        (bracket, picks, and Golden Boot) — use it to clear duplicate sign-ups;
        in Golden Boot it only drops that player&apos;s side-bet entry.
      </p>
      <AdminPaidList
        label="Pool buy-ins"
        players={poolRows}
        buyInCents={getBuyInCents()}
        kind="pool"
        emptyNote="No players yet."
        allowDelete
      />
      <AdminPaidList
        label="Golden Boot buy-ins"
        players={gbRows}
        buyInCents={getGoldenBootBuyInCents()}
        kind="goldenBoot"
        emptyNote="Nobody has opted into the Golden Boot yet."
        allowDelete
      />
    </div>
  );
}
