import { NextRequest, NextResponse } from "next/server";
import { getResults, setResults } from "@/lib/repo";
import { mergeResults, type Results } from "@/lib/scoring";

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
  // The cron POSTs feed-derived results every run; merge forward-only so a
  // flapped/partial poll can't regress a completed group (or any reach) and claw
  // back banked points. A genuine manual correction passes ?replace=1 to force
  // the body in verbatim (the only way to UN-set a wrong result).
  const replace = req.nextUrl.searchParams.get("replace") === "1";
  setResults(replace ? body : mergeResults(getResults(), body));
  return NextResponse.json({ ok: true });
}
