import { NextRequest, NextResponse } from "next/server";
import { getResults, setResults } from "@/lib/repo";
import type { Results } from "@/lib/scoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The score poller (GitHub Actions cron) POSTs actual results here. Secured by a
// shared secret in ADMIN_KEY. In dev (no key set) it's open on localhost.
function authed(req: NextRequest): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return process.env.NODE_ENV !== "production";
  return req.headers.get("x-admin-key") === key;
}

export async function GET(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(getResults());
}

export async function POST(req: NextRequest) {
  if (!authed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json()) as Results;
  setResults(body);
  return NextResponse.json({ ok: true });
}
