import { redirect } from "next/navigation";
import { getSessionPlayer } from "@/lib/session";
import { getAllGoldenBoot, getAllPlayers, getBuyInCents, getGroupName } from "@/lib/repo";
import { getGoldenBootBuyInCents } from "@/lib/goldenBoot";
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
  const nameById = new Map(players.map((p) => [p.id, p.name]));
  const gbRows = getAllGoldenBoot()
    .filter((g) => g.status === "in")
    .map((g) => ({ id: g.playerId, name: nameById.get(g.playerId) ?? g.playerId, paid: g.paid }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="min-h-dvh max-w-xl mx-auto px-4 pb-12">
      <TopNav context={`${getGroupName()} · Admin`} />
      <h1 className="text-xl font-extrabold mt-2">Buy-in tracker</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Only you can see this. Tap a name to flip whether they&apos;ve paid.
      </p>
      <AdminPaidList
        label="Pool buy-ins"
        players={poolRows}
        buyInCents={getBuyInCents()}
        kind="pool"
        emptyNote="No players yet."
      />
      <AdminPaidList
        label="Golden Boot buy-ins"
        players={gbRows}
        buyInCents={getGoldenBootBuyInCents()}
        kind="goldenBoot"
        emptyNote="Nobody has opted into the Golden Boot yet."
      />
    </div>
  );
}
