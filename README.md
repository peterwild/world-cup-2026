# World Cup 2026 — Friend-Group Bracket

A bracket pool for the 2026 FIFA World Cup (48 teams, 12 groups). Mobile-first,
festive, with an AI "Oracle" research mode and a money leaderboard.

## Status: prototype / pre-lock

**Brackets must lock before kickoff: 2026-06-11 15:00 ET (Mexico v South Africa).**

### ⚠️ Open before lock
- [ ] **Verify the 48-team group draw** in `src/lib/teams.ts` against the official
      FIFA bracket. Current data is DRAFT (single secondary source, NBC). Flip
      `TEAMS_VERIFIED` to `true` once confirmed.
- [ ] **Wire the score poller** once the tournament feed is live: get a
      football-data.org key, confirm WC 2026 is in its tier, set repo secrets
      (`FOOTBALL_DATA_KEY`, `SITE_URL`, `ADMIN_KEY`), and run the poll workflow
      with `--dry-run` to check team-name mapping (`unmapped` should be empty).
      See `src/lib/footballData.ts`.

## Stack
Next.js 16 / React 19 / Tailwind v4 — inherits the `ptwconsultingllc.com` design
system (see `fashion-finder` sibling project). Persistence: **SQLite on the box**
(`data/cup.db`, gitignored, box-only). AI: **AWS Bedrock** (Claude), streaming,
with a live-data tool. Scores: **football-data.org** polled by a GitHub Actions
cron hitting an authed `/api/` endpoint.

## Hosting — AWS Lightsail (clone of fashion-finder)
- Deploy = push to `main` → GitHub Action SSHes the box, `git reset`, `npm ci`,
  build, `pm2 restart`.
- nginx Basic Auth gates the site; path carve-outs for cron/API endpoints.
- Subdomain: `cup.ptwconsultingllc.com` (TBD).

## Format & scoring (`src/lib/tournament.ts`)
No literal bracket tree — players predict **which teams reach each round** (R32 →
Champion), which sidesteps the FIFA third-place pairing table.
- Group advance (top 2): **+3** each; group winner bonus **+1**.
- Reach round: R16 **2**, QF **4**, SF **8**, Final **12**, Champion **20**.
- Tiebreaker: predicted total goals in the final.
- Payout: 100% of pot to leaderboard, **60/30/10** top 3.

## Spirit Team (for fun, no money)
Each player picks one ride-or-die country. If it wins the Cup → a generated
"Spirit Champion" trophy card + AI victory ode + permanent 🏆 badge. No payout.

## Tests
`npm test` — Node's built-in runner over the pure logic (scoring + football-data
parsing). No test deps; a tiny resolver hook (`scripts/ts-ext-resolver.mjs`) lets
it import the app's extensionless TS.

## Build sequence
1. ✅ Foundation: config, seed data, scoring model, SQLite schema.
2. ✅ Bracket entry flow (mobile vertical tap-to-advance) + spirit pick + autosave.
3. ✅ Hard server-side lock + identity (name + group passcode).
4. ✅ Scoring engine + leaderboard + payouts + spirit badge (`/leaderboard`).
      Score poller (`scripts/poll-scores.mjs` + workflow) built — needs live-feed
      verification (see Open before lock).
5. AI Mode (Bedrock streaming + live-data tool).
6. Deploy: GitHub repo + Lightsail + nginx/DNS — needs Pete (no SSH from agent).
