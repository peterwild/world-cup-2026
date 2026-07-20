# World Cup 2026 — Friend-Group Bracket

A bracket pool for the 2026 FIFA World Cup (48 teams, 12 groups). Mobile-first,
festive, with an AI advisor over AWS Bedrock, live Monte Carlo win odds, and a
money leaderboard. Built and run for one friend group's private pool
(write-up: [petertwild.com](https://petertwild.com)).

## Status: archived, open-sourced post-tournament

The 2026 Cup is over and the pool is retired — this repo is kept as a working
reference to fork or re-provision for a future tournament, or to lift pieces
(the Bedrock advisor pattern, the reach-the-round scoring model, the Monte
Carlo odds engine) into something else. `terraform/` + `DEPLOY.md` still
describe a from-scratch Lightsail deploy if you want to stand it back up.

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
- Ran at `worldcup.ptwconsultingllc.com` for the 2026 tournament; the box is
  being retired now that the pool has closed out.

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

