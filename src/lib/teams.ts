// ─────────────────────────────────────────────────────────────────────────────
// 2026 FIFA World Cup — team + group seed data
//
// ⚠️  DRAFT — VERIFY BEFORE LOCK.
// Group assignments below are transcribed from a single secondary source
// (NBC Sports, June 2026) and have NOT yet been confirmed against the official
// FIFA bracket. People are betting real money on these exact teams, so this
// file must be cross-checked against fifa.com/worldcup before brackets lock
// (kickoff: 2026-06-11 15:00 ET). See VERIFIED below.
//
// `flag` is the flag-icons class suffix (ISO 3166-1 alpha-2, lowercase), with
// the UK home nations as gb-eng / gb-sct / gb-wls. Render as <span class="fi fi-{flag}" />.
// ─────────────────────────────────────────────────────────────────────────────

export const TEAMS_VERIFIED = false; // flip to true once confirmed vs official FIFA bracket

export type GroupId =
  | "A" | "B" | "C" | "D" | "E" | "F"
  | "G" | "H" | "I" | "J" | "K" | "L";

export interface Team {
  /** stable slug used as the DB key for picks — never renumber */
  id: string;
  name: string;
  /** flag-icons suffix, e.g. "br", "gb-eng" */
  flag: string;
  group: GroupId;
}

export const TEAMS: Team[] = [
  // Group A
  { id: "cze", name: "Czechia", flag: "cz", group: "A" },
  { id: "mex", name: "Mexico", flag: "mx", group: "A" },
  { id: "kor", name: "South Korea", flag: "kr", group: "A" },
  { id: "rsa", name: "South Africa", flag: "za", group: "A" },
  // Group B
  { id: "bih", name: "Bosnia and Herzegovina", flag: "ba", group: "B" },
  { id: "can", name: "Canada", flag: "ca", group: "B" },
  { id: "qat", name: "Qatar", flag: "qa", group: "B" },
  { id: "sui", name: "Switzerland", flag: "ch", group: "B" },
  // Group C
  { id: "bra", name: "Brazil", flag: "br", group: "C" },
  { id: "hai", name: "Haiti", flag: "ht", group: "C" },
  { id: "mar", name: "Morocco", flag: "ma", group: "C" },
  { id: "sco", name: "Scotland", flag: "gb-sct", group: "C" },
  // Group D
  { id: "aus", name: "Australia", flag: "au", group: "D" },
  { id: "par", name: "Paraguay", flag: "py", group: "D" },
  { id: "tur", name: "Turkiye", flag: "tr", group: "D" },
  { id: "usa", name: "USA", flag: "us", group: "D" },
  // Group E
  { id: "cuw", name: "Curacao", flag: "cw", group: "E" },
  { id: "ecu", name: "Ecuador", flag: "ec", group: "E" },
  { id: "ger", name: "Germany", flag: "de", group: "E" },
  { id: "civ", name: "Ivory Coast", flag: "ci", group: "E" },
  // Group F
  { id: "jpn", name: "Japan", flag: "jp", group: "F" },
  { id: "ned", name: "Netherlands", flag: "nl", group: "F" },
  { id: "swe", name: "Sweden", flag: "se", group: "F" },
  { id: "tun", name: "Tunisia", flag: "tn", group: "F" },
  // Group G
  { id: "bel", name: "Belgium", flag: "be", group: "G" },
  { id: "egy", name: "Egypt", flag: "eg", group: "G" },
  { id: "irn", name: "Iran", flag: "ir", group: "G" },
  { id: "nzl", name: "New Zealand", flag: "nz", group: "G" },
  // Group H
  { id: "cpv", name: "Cape Verde", flag: "cv", group: "H" },
  { id: "ksa", name: "Saudi Arabia", flag: "sa", group: "H" },
  { id: "esp", name: "Spain", flag: "es", group: "H" },
  { id: "uru", name: "Uruguay", flag: "uy", group: "H" },
  // Group I
  { id: "fra", name: "France", flag: "fr", group: "I" },
  { id: "irq", name: "Iraq", flag: "iq", group: "I" },
  { id: "nor", name: "Norway", flag: "no", group: "I" },
  { id: "sen", name: "Senegal", flag: "sn", group: "I" },
  // Group J
  { id: "alg", name: "Algeria", flag: "dz", group: "J" },
  { id: "arg", name: "Argentina", flag: "ar", group: "J" },
  { id: "aut", name: "Austria", flag: "at", group: "J" },
  { id: "jor", name: "Jordan", flag: "jo", group: "J" },
  // Group K
  { id: "col", name: "Colombia", flag: "co", group: "K" },
  { id: "cod", name: "DR Congo", flag: "cd", group: "K" },
  { id: "por", name: "Portugal", flag: "pt", group: "K" },
  { id: "uzb", name: "Uzbekistan", flag: "uz", group: "K" },
  // Group L
  { id: "cro", name: "Croatia", flag: "hr", group: "L" },
  { id: "eng", name: "England", flag: "gb-eng", group: "L" },
  { id: "gha", name: "Ghana", flag: "gh", group: "L" },
  { id: "pan", name: "Panama", flag: "pa", group: "L" },
];

export const GROUP_IDS: GroupId[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];

export const TEAMS_BY_ID: Record<string, Team> = Object.fromEntries(
  TEAMS.map((t) => [t.id, t]),
);

export function teamsInGroup(group: GroupId): Team[] {
  return TEAMS.filter((t) => t.group === group);
}
