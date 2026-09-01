/**
 * What a run costs, before you press the button.
 *
 * Unit prices are published rates (checked 2026-09-01). Token counts per call are
 * estimated from the prompts in ai.ts, so treat the totals as an order of magnitude,
 * not an invoice — they are here to stop a 100k-lead search being a surprise.
 *
 * ponytail: hand-estimated token counts, and they do drift — the Sonnet rate here was a
 * generation out of date, quoting scoring 50% over. Real per-call usage now lands in the
 * `ai_usage` table (see ai.ts); correct the numbers below against it periodically.
 * Pure module — no imports, safe on the client.
 */

/** USD per million tokens. platform.claude.com/docs — Claude API list prices. */
const RATE = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
} as const

/** $0.01 per server-side web search, on top of the tokens the results occupy. */
const WEB_SEARCH = 0.01

const call = (model: keyof typeof RATE, inTok: number, outTok: number, searches = 0) =>
  (inTok * RATE[model].in + outTok * RATE[model].out) / 1_000_000 + searches * WEB_SEARCH

/**
 * Apify `code_crafter/leads-finder`: $0.02 to start a run, then per lead *returned* —
 * the requested count is a ceiling, not a charge. $0.002 on Free/Bronze, $0.0018 on
 * Silver, $0.0015 on Gold and above; the worst case is the honest one to quote.
 */
export const APIFY_PER_LEAD = 0.002
export const APIFY_RUN_START = 0.02

/** Per-lead unit costs through the pipeline. */
export const UNIT = {
  /** Sonnet 5, low effort: ICP + lead context in, a score and an angle out. */
  qualify: call('claude-sonnet-5', 900, 700),
  /** Haiku 4.5 with web search. Dominated by the pages it pulls back, not the writing. */
  research: call('claude-haiku-4-5', 45_000, 1_200, 3),
  /** Sonnet 5: offer, guidelines, research and thread in; one email out. */
  draft: call('claude-sonnet-5', 2_400, 1_600),
  /** Opus 5 reading the pages you paste, then writing every campaign field. Once. */
  campaign: call('claude-opus-5', 60_000, 6_000, 4) + 0.4,
} as const

export const searchCost = (leads: number) => APIFY_RUN_START + leads * APIFY_PER_LEAD

/**
 * A campaign pass. Everything enrolled gets scored; only what clears the floor is
 * researched and written, and research is paid once per company for all time.
 *
 * Scoring looks like the obvious thing to cut and is the one thing here that must stay:
 * it is the cheapest call in the pipeline and it is the gate on the two expensive ones,
 * so it pays for itself the moment it rejects more than qualify/(research+draft) — about
 * 9% — of a campaign's leads. Watch min_score. A campaign passing 99% of what it scores
 * is buying a filter that does not filter, and that is the only case where the scoring
 * spend is genuinely wasted.
 */
export function campaignCost(counts: { toScore: number; toResearch: number; toDraft: number }) {
  return (
    counts.toScore * UNIT.qualify +
    counts.toResearch * UNIT.research +
    counts.toDraft * UNIT.draft
  )
}

/** Under a cent reads as free, which is misleading at 10 000 leads. Never round to $0. */
export function usd(amount: number): string {
  if (amount <= 0) return '$0'
  if (amount < 0.01) return '<$0.01'
  if (amount < 10) return `$${amount.toFixed(2)}`
  return `$${Math.round(amount).toLocaleString('en-US')}`
}

/** For a per-unit price, "<$0.01" is useless — $0.002 and $0.009 are 4.5x apart. */
export const unitUsd = (amount: number) =>
  `$${amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
