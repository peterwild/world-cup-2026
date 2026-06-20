// ─────────────────────────────────────────────────────────────────────────────
// Prototype identity: an opaque player-id cookie. The site sits behind nginx
// Basic Auth (group-level gate) in production, and the in-app group passcode
// gates who can create a player. This is friend-group-grade, not bank-grade —
// anyone with the passcode could claim any name. Add a per-person PIN later if
// it matters.
// ─────────────────────────────────────────────────────────────────────────────

import { cookies } from "next/headers";
import { getPlayer, type Player } from "./repo";

const COOKIE = "wc_player";
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days

export async function getSessionPlayerId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

/** The logged-in player row (carries the is_admin flag), or null. */
export async function getSessionPlayer(): Promise<Player | null> {
  const id = await getSessionPlayerId();
  return id ? getPlayer(id) : null;
}

/** True only for a player whose row was blessed is_admin server-side (set on
 *  the box, never claimable in-app). Gates the admin buy-in view + actions. */
export async function isAdminSession(): Promise<boolean> {
  return !!(await getSessionPlayer())?.is_admin;
}

export async function setSessionPlayerId(id: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
