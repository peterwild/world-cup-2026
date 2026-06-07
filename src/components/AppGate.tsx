"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "./LoginForm";
import { BracketWizard } from "./BracketWizard";
import type { Player } from "@/lib/repo";

export function AppGate() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => setPlayer(d.player ?? null))
      .catch(() => setPlayer(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-dvh bg-background" />;
  if (!player) return <LoginForm onLogin={setPlayer} />;
  return <BracketWizard player={player} />;
}
