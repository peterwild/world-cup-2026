// ─────────────────────────────────────────────────────────────────────────────
// AI Mode budget + tariff. Every player gets an AI budget equal to the buy-in
// ($50). Talking to the AI costs "game dollars" so that model choice is a real
// strategic tradeoff — explore cheap on Haiku, spend big on Opus for the final
// call. The tariff also doubles as a hard cap on real AWS Bedrock spend (which
// stays in the single-digit dollars overall).
//
// Tuning: these are the only numbers to touch. Rates are game-dollars per 1K
// tokens. Target with a $50 budget:  ~10 Opus turns · ~30 Sonnet · ~90 Haiku.
// ─────────────────────────────────────────────────────────────────────────────

export type ModelKey = "opus" | "sonnet" | "haiku";

export interface ModelConfig {
  /** Bedrock inference-profile id (global.* profiles, us-east-1; all ACTIVE). */
  id: string;
  label: string;
  blurb: string;
  /** game-dollars per 1K input tokens */
  inPer1k: number;
  /** game-dollars per 1K output tokens */
  outPer1k: number;
}

export const MODELS: Record<ModelKey, ModelConfig> = {
  opus: {
    // Opus 4.6 — the strongest Opus this account is actually granted (4.7/4.8
    // profiles list as ACTIVE but invoke with AccessDenied).
    id: "global.anthropic.claude-opus-4-6-v1",
    label: "Opus",
    blurb: "Smartest, pricey — save it for the big calls",
    inPer1k: 0.8,
    outPer1k: 3.2,
  },
  sonnet: {
    id: "global.anthropic.claude-sonnet-4-6",
    label: "Sonnet",
    blurb: "Balanced — sharp enough, won't drain you",
    inPer1k: 0.25,
    outPer1k: 1.0,
  },
  haiku: {
    id: "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    label: "Haiku",
    blurb: "Cheap & chatty — explore all you want",
    inPer1k: 0.08,
    outPer1k: 0.32,
  },
};

export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

export function isModelKey(s: string | null | undefined): s is ModelKey {
  return !!s && s in MODELS;
}

/** Token usage as reported by Bedrock's Converse `usage` block. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Cost of one turn, in cents, for the chosen model. Billed on headline input +
 * output tokens — when the static system prompt is cache-read, `inputTokens`
 * drops, so caching cuts both the real bill AND the player's game spend. Fair.
 */
export function costCents(model: ModelKey, usage: TokenUsage): number {
  const m = MODELS[model];
  const dollars =
    (usage.inputTokens / 1000) * m.inPer1k + (usage.outputTokens / 1000) * m.outPer1k;
  return Math.round(dollars * 100);
}

/** Budget remaining, never negative (a turn that starts in-budget may overrun). */
export function remainingCents(budgetCents: number, spentCents: number): number {
  return Math.max(0, budgetCents - spentCents);
}

/** Out of budget: no new prompts allowed (an in-flight turn always completes). */
export function isOverBudget(budgetCents: number, spentCents: number): boolean {
  return spentCents >= budgetCents;
}
