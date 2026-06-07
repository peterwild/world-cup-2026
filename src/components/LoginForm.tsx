"use client";

import { useState } from "react";
import type { Player } from "@/lib/repo";

export function LoginForm({ onLogin }: { onLogin: (p: Player) => void }) {
  const [name, setName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, passcode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      onLogin(data.player as Player);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-dvh flex flex-col items-center justify-center px-6 max-w-xl mx-auto">
      <div className="text-6xl mb-5">🏆⚽️</div>
      <p className="eyebrow">Kitchen Table pool</p>
      <h1 className="text-4xl font-extrabold tracking-tight mt-1 text-center">
        World Cup 2026
      </h1>
      <p className="text-muted-foreground mt-3 mb-8 text-center max-w-sm">
        Sign in with your name and the group passcode to build your bracket.
      </p>

      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          className="w-full px-4 py-3 rounded-xl bg-card border border-border outline-none focus:border-[var(--pitch)] transition"
        />
        <input
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Group passcode"
          type="password"
          autoComplete="off"
          className="w-full px-4 py-3 rounded-xl bg-card border border-border outline-none focus:border-[var(--pitch)] transition"
        />
        {error && <p className="text-sm text-destructive px-1">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim() || !passcode.trim()}
          className="w-full px-5 py-3 rounded-xl text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40"
          style={{ background: "var(--pitch)", color: "white" }}
        >
          {busy ? "Signing in…" : "Enter the pool"}
        </button>
      </form>
    </div>
  );
}
