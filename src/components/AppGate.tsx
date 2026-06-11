"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "./LoginForm";
import { BracketWizard } from "./BracketWizard";
import type { Player } from "@/lib/repo";

export function AppGate({ locked = false }: { locked?: boolean }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setPlayer(d.player ?? null))
      .catch(() => setPlayer(null))
      .finally(() => setLoading(false));
  }, []);

  // Post-lock there's nothing to edit — logging in lands on the leaderboard.
  // (The server redirect in app/page.tsx covers already-logged-in visits;
  // this covers a fresh login while locked.)
  useEffect(() => {
    if (locked && player) router.replace("/leaderboard");
  }, [locked, player, router]);

  if (loading || (locked && player)) return <div className="h-dvh bg-background" />;
  if (!player) return <LoginForm onLogin={setPlayer} />;
  return <BracketWizard player={player} />;
}
