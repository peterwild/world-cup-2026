// Refresh the Elo snapshot in src/lib/elo.ts from eloratings.net (World
// Football Elo — the same source the table approximates). Manual tool:
//   node --import ./scripts/ts-ext-resolver.mjs scripts/refresh-elo.mjs            # print diff
//   node --import ./scripts/ts-ext-resolver.mjs scripts/refresh-elo.mjs --write    # rewrite elo.ts
//
// eloratings.net has no formal API; its own frontend reads these TSVs:
//   World.tsv     rank \t ? \t CODE \t rating \t ...
//   en.teams.tsv  CODE \t English name [\t alt names...]
// If the format drifts, this script fails loudly — it never writes garbage.

import fs from "node:fs";
import { TEAMS, GROUP_IDS } from "../src/lib/teams.ts";
import { nameToId } from "../src/lib/footballData.ts";
import { ELO } from "../src/lib/elo.ts";

const WRITE = process.argv.includes("--write");
const ELO_PATH = new URL("../src/lib/elo.ts", import.meta.url).pathname;

async function fetchTsv(name) {
  const res = await fetch(`https://www.eloratings.net/${name}`, {
    headers: { "User-Agent": "wc26-pool-elo-refresh" },
  });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.includes("\t")) throw new Error(`${name}: not TSV-shaped`);
  return text.trim().split("\n").map((l) => l.split("\t"));
}

const [world, names] = await Promise.all([fetchTsv("World.tsv"), fetchTsv("en.teams.tsv")]);

// code → all listed English names (first column is the code, rest are spellings)
const codeNames = new Map();
for (const row of names) {
  const [code, ...rest] = row;
  if (code && rest.length) codeNames.set(code, rest);
}

// code → current rating. World.tsv: rank, ?, CODE, rating, ...
const ratingByCode = new Map();
for (const row of world) {
  const code = row[2];
  const rating = Number(row[3]);
  if (code && Number.isFinite(rating)) ratingByCode.set(code, rating);
}
if (ratingByCode.size < 100) {
  throw new Error(`World.tsv parsed only ${ratingByCode.size} teams — format drifted? Aborting.`);
}

// Resolve each eloratings code to one of OUR team ids via its English names
// (reuses footballData's alias table so spellings stay in one place).
const fresh = new Map(); // our id → rating
for (const [code, rating] of ratingByCode) {
  for (const name of codeNames.get(code) ?? []) {
    const id = nameToId(name);
    if (id) {
      fresh.set(id, rating);
      break;
    }
  }
}

const missing = TEAMS.filter((t) => !fresh.has(t.id)).map((t) => t.name);
if (missing.length) {
  throw new Error(
    `No fresh rating for: ${missing.join(", ")} — add aliases in footballData.ts. Aborting.`,
  );
}

// ── Diff report ──
console.log("team            old    new   delta");
let maxAbs = 0;
for (const t of [...TEAMS].sort((a, b) => fresh.get(b.id) - fresh.get(a.id))) {
  const oldR = ELO[t.id];
  const newR = fresh.get(t.id);
  const d = newR - oldR;
  maxAbs = Math.max(maxAbs, Math.abs(d));
  console.log(
    `${t.name.padEnd(15)}${String(oldR).padStart(5)}${String(newR).padStart(7)}   ${d >= 0 ? "+" : ""}${d}`,
  );
}
console.log(`\nlargest move: ${maxAbs} Elo points`);

if (!WRITE) {
  console.log("\nDry run — re-run with --write to update src/lib/elo.ts");
  process.exit(0);
}

// ── Rewrite the ELO table block in place, preserving the group comments ──
const lines = [];
for (const g of GROUP_IDS) {
  const members = TEAMS.filter((t) => t.group === g);
  lines.push(`  // Group ${g}`);
  lines.push("  " + members.map((t) => `${t.id}: ${fresh.get(t.id)},`).join(" "));
}
const table = `export const ELO: Record<string, number> = {\n${lines.join("\n")}\n};`;

const src = fs.readFileSync(ELO_PATH, "utf8");
const re = /export const ELO: Record<string, number> = \{[\s\S]*?\n\};/;
if (!re.test(src)) throw new Error("Could not locate the ELO table block in elo.ts. Aborting.");
fs.writeFileSync(ELO_PATH, src.replace(re, table));
console.log(`\nWrote ${fresh.size} ratings to src/lib/elo.ts — review with git diff, then run tests.`);
