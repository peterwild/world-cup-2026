import { redirect } from "next/navigation";
import { getSessionPlayerId } from "@/lib/session";
import { isLocked } from "@/lib/db";
import { AppGate } from "@/components/AppGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Home() {
  // Post-lock the wizard is dead weight (every write 423s) — the app's home
  // becomes the leaderboard. Logged-out visitors still get the login form.
  const locked = isLocked();
  if (locked && (await getSessionPlayerId())) redirect("/leaderboard");
  return <AppGate locked={locked} />;
}
