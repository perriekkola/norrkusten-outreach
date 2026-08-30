import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  COMPANY_SIZE,
  EMAIL_STATUS,
  FUNCTION,
  INDUSTRIES,
  REVENUE,
  SENIORITY,
  matchLocations,
  type Option,
} from './apify-options'
import type { Campaign, Lead } from './db'
import { decodeEscapes, looksMangled } from './format'

/**
 * One model per task, overridable without a deploy. Research dominates the bill —
 * web search pulls tens of thousands of input tokens per lead — and it is summarising
 * fetched pages, so Haiku carries it. Drafting stays on Opus: that output is the reply rate.
 */
const MODEL = {
  qualify: process.env.CLAUDE_MODEL_QUALIFY || 'claude-sonnet-5',
  research: process.env.CLAUDE_MODEL_RESEARCH || 'claude-haiku-4-5',
  draft: process.env.CLAUDE_MODEL_DRAFT || 'claude-opus-5',
  /** Once per campaign, and every later email depends on it — worth the best model. */
  campaign: process.env.CLAUDE_MODEL_CAMPAIGN || 'claude-opus-5',
}

/** Haiku 4.5 predates both `output_config.effort` and the 2026 web-search tool. */
const isLegacy = (model: string) => model.includes('haiku-4-5') || model.includes('-4-5')

const effort = (model: string, level: 'low' | 'medium' | 'high') =>
  isLegacy(model) ? undefined : level

let client: Anthropic | null = null
function anthropic() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
    // 529 overloaded is common and transient, and these calls are slow enough that
    // losing one to a blip is expensive. The SDK backs off exponentially between tries.
    client = new Anthropic({ maxRetries: 5 })
  }
  return client
}

function textOf(content: Anthropic.ContentBlock[]) {
  return content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * A server-tool turn interleaves the model's narration ("I'll search for…") with the
 * tool blocks, so joining every text block drags that preamble into the result.
 * Only the text after the last tool block is the actual answer.
 */
function finalText(content: Anthropic.ContentBlock[]) {
  let lastTool = -1
  content.forEach((block, index) => {
    if (block.type.includes('tool')) lastTool = index
  })
  return textOf(content.slice(lastTool + 1)) || textOf(content)
}

/**
 * Turns an SDK error into something worth showing a user. Most specific first —
 * RateLimitError and InternalServerError both extend APIError, so order matters.
 */
export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach Claude. Check the connection and try again.'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Claude is rate-limiting us. Wait a minute and try again.'
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return 'ANTHROPIC_API_KEY is missing or invalid.'
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 529) {
      return 'Claude is overloaded right now. Nothing is wrong with your input — try again in a minute.'
    }
    if (typeof error.status === 'number' && error.status >= 500) {
      return `Claude had a server error (${error.status}). Try again shortly.`
    }
    return `Claude rejected the request (${error.status}): ${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

function guardRefusal(message: { stop_reason: string | null }) {
  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined this request. Rephrase the ICP or offer and try again.')
  }
}

function leadContext(lead: Lead) {
  return [
    `Name: ${lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || '—'}`,
    `Title: ${lead.job_title ?? '—'}`,
    `Seniority: ${lead.seniority ?? '—'}`,
    `Email: ${lead.email}`,
    `LinkedIn: ${lead.linkedin ?? '—'}`,
    `Location: ${[lead.city, lead.country].filter(Boolean).join(', ') || '—'}`,
    `Company: ${lead.company_name ?? '—'} (${lead.company_domain ?? 'no domain'})`,
    `Industry: ${lead.industry ?? '—'}`,
    `Company size: ${lead.company_size ?? '—'}`,
    `Company description: ${lead.company_description ?? '—'}`,
  ].join('\n')
}

/* ------------------------------------------------------------------ qualify */

const Qualification = z.object({
  score: z.number().min(0).max(100).describe('0-100 fit against the ICP'),
  verdict: z.enum(['strong', 'medium', 'weak']),
  reasons: z.string().describe('2-3 sentences on why this score'),
  angle: z.string().describe('The single most promising hook for a first email'),
})

export type Qualification = z.infer<typeof Qualification>

export async function qualifyLead(lead: Lead, icp: string): Promise<Qualification> {
  const message = await anthropic().messages.parse({
    model: MODEL.qualify,
    max_tokens: 4000,
    output_config: { effort: effort(MODEL.qualify, 'low'), format: zodOutputFormat(Qualification) },
    system:
      'You score B2B leads for an e-learning course provider. Be strict: most leads are a weak ' +
      'fit. Score on decision-making power over training budgets, likely need for the courses ' +
      'described, and company size/industry match. Never invent facts about the lead.',
    messages: [
      {
        role: 'user',
        content: `Ideal customer profile and what we sell:\n${icp}\n\nLead:\n${leadContext(lead)}`,
      },
    ],
  })
  guardRefusal(message)
  if (!message.parsed_output) throw new Error('Claude returned no qualification')
  const { reasons, angle, ...rest } = message.parsed_output
  return { ...rest, reasons: decodeEscapes(reasons), angle: decodeEscapes(angle) }
}

/* ----------------------------------------------------------------- research */

/** Uses Claude's server-side web search, so it needs no scraping infrastructure. */
export async function researchCompany(lead: Lead): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        `Research this company for a cold outreach email. Search the web.\n\n${leadContext(lead)}\n\n` +
        'Return a short brief of at most 200 words covering: what they do, recent news or ' +
        'hiring signals from the last 12 months, anything suggesting a need for staff training ' +
        'or upskilling, and one concrete, specific detail worth referencing in a first email. ' +
        'If the web results are thin, say so plainly instead of guessing.\n\n' +
        'Write plain prose only. No markdown, no headings, no bold, no bullet lists, no title, ' +
        'and no preamble about what you are about to do — this text is pasted straight into ' +
        'another prompt, so start with the first fact.',
    },
  ]

  // Server tools can pause the turn; continue until Claude finishes (bounded).
  for (let attempt = 0; attempt < 4; attempt++) {
    const message = await anthropic().messages.create({
      model: MODEL.research,
      max_tokens: 8000,
      ...(isLegacy(MODEL.research) ? {} : { output_config: { effort: 'low' as const } }),
      tools: [
        isLegacy(MODEL.research)
          ? { type: 'web_search_20250305' as const, name: 'web_search' as const, max_uses: 6 }
          : { type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 6 },
      ],
      messages,
    })
    guardRefusal(message)
    if (message.stop_reason !== 'pause_turn') return decodeEscapes(finalText(message.content))
    messages.push({ role: 'assistant', content: message.content })
  }
  throw new Error('Research did not finish — try again')
}

/* -------------------------------------------------------------------- draft */

const Draft = z.object({
  subject: z
    .string()
    .describe('Sentence case, like a human typed it. Short and specific. No emoji, no fake "Re:".'),
  body: z
    .string()
    .describe(
      'Plain text body, opening greeting included. No sign-off and no name — a signature is ' +
        'appended afterwards. No markdown.',
    ),
})

export type Draft = z.infer<typeof Draft>

export async function draftEmail(args: {
  lead: Lead
  campaign: Campaign
  step: number
  senderName: string
  /** From the enrollment — this campaign's angle, not a global one. */
  angle: string | null
  previous: { subject: string; body: string }[]
}): Promise<Draft> {
  const { lead, campaign, step, senderName, angle, previous } = args
  const goal = campaign.steps[step]?.goal ?? 'A brief, polite follow-up.'
  const language = campaign.language === 'sv' ? 'Swedish' : campaign.language
  const guidelines = campaign.guidelines ?? ''

  const thread = previous.length
    ? previous
        .map((m, i) => `--- Email ${i + 1} (already sent)\nSubject: ${m.subject}\n${m.body}`)
        .join('\n\n')
    : '(none — this is the first touch)'

  const message = await anthropic().messages.parse({
    model: MODEL.draft,
    max_tokens: 8000,
    output_config: { format: zodOutputFormat(Draft) },
    system: [
      `You write cold outreach emails in ${language}. They go out from ${senderName}, whose`,
      'signature is appended after your text — you never write it yourself.',
      '',
      'Hard rules:',
      '- Under 120 words. Plain text, no markdown.',
      '- Never tell the recipient what their own company does. They know. Research and the',
      '  scraped description exist so YOU can judge what is relevant to them — they are not',
      '  material to recite back. "Ni konstruerar X" as an opening line is the single worst',
      '  thing you can write.',
      '- Open with the reason this matters to them, not with who we are or who they are.',
      '- At most one specific detail about them, and only if it changes what you are saying.',
      '  Weave it in mid-sentence; never as the opening clause.',
      '- Never invent facts. If the research is thin, write a shorter, more general email',
      '  rather than filling space with guesses.',
      '- No flattery, no "hoppas det här mejlet finner dig väl", no buzzwords, no fake urgency,',
      '  no "jag såg att...", no company boilerplate, no phone-number sign-off.',
      '- Exactly one ask, and it is whatever the goal for this email says. Do not substitute a',
      '  meeting request for it.',
      // A course bought on a page for a few thousand kronor has no meeting to book, and asking
      // for one reads as a sales call. This outranks the step goal deliberately: the goal text
      // is stored per campaign and the old default told it to ask for fifteen minutes.
      ...(campaign.links?.length
        ? [
            '- The close is the link, every time. This campaign sells something the reader buys',
            '  on the page, so the ask is to read the course page and buy — nothing else. Never',
            '  propose a meeting, a call, a demo, or "15 minuter", not as the ask, not as a',
            '  softener, not as an alternative, and not as a question at the end. If the goal',
            '  below asks for a call, ignore that part of it and point at the page instead.',
          ]
        : []),
      '- Do not write a sign-off, a closing greeting or your name. A signature is appended',
      '  automatically after your text. End on the last sentence of the message itself.',
      guidelines.trim() ? `\nCampaign-specific rules, these override the defaults:\n${guidelines.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `What we sell:\n${campaign.offer}`,
          `Goal of this email (step ${step + 1} of ${campaign.steps.length}):\n${goal}`,
          campaign.links?.length
            ? `Include ${campaign.links.length === 1 ? 'this link' : 'the most relevant of these links'} ` +
              `as a bare URL on its own line. Never more than one link per email, and never ` +
              `a URL that is not in this list:\n${campaign.links.join('\n')}`
            : 'There is no link for this campaign — do not invent a URL.',
          `Lead:\n${leadContext(lead)}`,
          `Qualification angle for this campaign: ${angle ?? '—'}`,
          `Company research:\n${lead.research ?? '(none)'}`,
          `Earlier emails in this thread:\n${thread}`,
        ].join('\n\n'),
      },
    ],
  })
  guardRefusal(message)
  if (!message.parsed_output) throw new Error('Claude returned no draft')
  return {
    subject: decodeEscapes(message.parsed_output.subject),
    body: decodeEscapes(message.parsed_output.body),
  }
}

/**
 * Write one email, rejecting a draft whose Swedish letters came back as line breaks.
 *
 * The retry is the whole point: the corruption is a sampling accident, not a bad prompt,
 * so asking again almost always produces a clean draft. Failing loudly on the second try
 * beats storing it — a mangled body in the outbox is one approval click from a real
 * person, and an auto-send campaign does not even pause for that.
 */
export async function draftEmailChecked(args: Parameters<typeof draftEmail>[0]): Promise<Draft> {
  let last: Draft | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await draftEmail(args)
    if (!looksMangled(draft.body) && !looksMangled(draft.subject)) return draft
    last = draft
    console.error('draft came back mangled, retrying', { attempt, subject: draft.subject })
  }
  throw new Error(
    `Claude returned a draft with broken Swedish characters twice in a row (${last?.subject ?? ''}). ` +
      'Nothing was saved — try again.',
  )
}

/* ----------------------------------------------------------------- campaign */

const CampaignDraft = z.object({
  name: z
    .string()
    .max(40)
    .describe('Internal label, under 40 characters. No tagline, no colon-and-explainer.'),
  language: z.enum(['sv', 'en', 'no', 'da', 'fi']),
  source_search_ids: z
    .array(z.number())
    .describe(
      'Which of the offered searches feed this campaign. Pick every one whose label plausibly ' +
        'matches the ICP; pick none only if none of them could. Never leave this empty when a ' +
        'plausible search exists — an empty list means the campaign pulls no leads and does nothing.',
    ),
  icp: z
    .string()
    .min(1)
    .describe(
      'The scoring rubric, and the ONLY field the scoring model reads. Never empty, never one ' +
        'line. All three bands, always: strong fit (75-100), medium (40-74) and poor (0-39), ' +
        'each with reasons. The poor band must name competitors who sell the same thing, by ' +
        'name where known, or every lead scores high and the score floor is useless.',
    ),
  offer: z
    .string()
    .describe(
      'What is being sold, in verifiable detail: exact course names, format, length, price, ' +
        'terms, what it covers, who it is for. Only what the source pages state.',
    ),
  guidelines: z
    .string()
    .describe(
      'How the emails must read: the single call to action, tone, and an explicit list of what ' +
        'never to do. Must forbid repeating any marketing superlative found on the source page.',
    ),
  min_score: z.number().min(0).max(100),
  steps: z
    .array(
      z.object({
        delay_days: z.number().min(0).max(60),
        goal: z
          .string()
          .describe('The one argument this email makes, and what it must not do. Be explicit.'),
      }),
    )
    .min(2)
    .max(4)
    .describe(
      'Three steps unless there is a clear reason for two or four. First delay_days is 0; later ' +
        'ones are days since the previous send. Every step must carry a different argument — two ' +
        'steps that both push urgency is one step too many.',
    ),
})

export type CampaignDraft = z.infer<typeof CampaignDraft> & { links: string[] }

type Report = (event: { phase: string; detail?: string }) => void

/** Reads whatever the user pasted — links get fetched, claims get checked. */
async function readSources(brief: string, links: string[], report: Report): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        `Research the basis for a cold outreach campaign.\n\nWhat we want to sell:\n${brief}\n\n` +
        (links.length
          ? `Fetch each of these pages and summarise them:\n${links.join('\n')}\n\n`
          : 'No pages were given — search the web for what is described above.\n\n') +
        'Return plain prose, no markdown. Cover, for each product: exact name, what it covers, ' +
        'who it is aimed at, format, length, price, and anything that removes buying friction ' +
        'such as certificates or volume discounts. Then note any deadline, regulation or event ' +
        'that makes this urgent right now, with dates. State plainly what you could not find ' +
        'rather than guessing — an invented price ends up in a real email.',
    },
  ]

  report({ phase: links.length ? 'Reading the pages you gave me' : 'Searching the web' })

  for (let attempt = 0; attempt < 4; attempt++) {
    const message = await anthropic().messages.create({
      model: MODEL.campaign,
      max_tokens: 8000,
      tools: [
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
      ],
      messages,
    })
    guardRefusal(message)

    // Say which page or query it actually reached for, not just that it is busy.
    for (const block of message.content) {
      if (block.type !== 'server_tool_use') continue
      const input = block.input as { url?: string; query?: string }
      if (input.url) report({ phase: 'Fetching', detail: input.url })
      else if (input.query) report({ phase: 'Searching', detail: input.query })
    }

    if (message.stop_reason !== 'pause_turn') return finalText(message.content)
    messages.push({ role: 'assistant', content: message.content })
  }
  throw new Error('Reading the sources did not finish — try again')
}

/** Shared by drafting and revising, so a rule added for one can never be missing from the other. */
const CAMPAIGN_SYSTEM = [
  'You set up cold outreach campaigns. Every field you write is consumed by another model',
  'that treats it as fact, and the result is sent to a real person who may know the subject',
  'better than you. Write only what the research below establishes.',
  '',
  'Claims and sourcing:',
  '- The offer may contain only what the source pages state. If the page does not give an',
  '  access period, a guarantee or a term of sale, do not supply one.',
  '- A dated regulatory deadline is a fact and may be used. Legal consequences derived from',
  '  it are not: never assert that there is no transition period, that something is mandatory,',
  '  that a party is liable, or that an authority requires anything, even if it seems to',
  '  follow. Say what the course covers instead of what the law obliges.',
  '- Never write a rule about signing off, closing greetings or the sender\'s name. A',
  '  signature is configured on the mailbox and appended automatically; a guideline telling',
  '  the writer to sign would contradict that and produce two sign-offs.',
  '- If the source page makes a marketing superlative ("the most comprehensive in Sweden"),',
  '  record it in the offer as the page\'s claim, and forbid it in the guidelines. Repeating a',
  '  superlative to an engineer costs credibility.',
  '',
  'The ICP is the one field you must never leave thin or empty. It is the entire rubric',
  'the scoring model gets — no other field is read when scoring — so a campaign whose ICP',
  'is blank or one line scores nothing, drafts nothing and sends nothing. Always write all',
  'three bands in full, even when the brief is short:',
  '- STRONG (75-100): country, company size, what the company actually does, and the job',
  '  titles that own the problem. Give the titles in the market\'s own language.',
  '- MEDIUM (40-74): the right company with the wrong person, or an adjacent use case.',
  '- POOR (0-39): who never qualifies, competitors who sell the same thing included, by',
  '  name where you know them. Without that band every lead scores high and the floor is dead.',
  'If the brief did not tell you enough to fill a band, infer it from the offer and say so',
  'inside the ICP. Returning an empty or single-sentence ICP is a broken campaign, not a',
  'cautious one.',
  '',
  'One more thing people get wrong: the ask has to match the price. A self-serve product',
  'costing a few thousand kronor sends people to the page to read and buy. It never asks for',
  'a meeting, a call or fifteen minutes, and the guidelines must forbid those explicitly.',
  '',
  'Shape of the sequence: three emails is the default. Each one makes a different argument —',
  'if you cannot give a step its own argument, do not add the step. Do not write a fifth.',
  '',
  'Pick the source searches from the list given. Leaving that empty produces a campaign that',
  'silently does nothing, so only do it if no offered search could match the ICP at all.',
].join('\n')

const searchList = (searches: { id: number; label: string; leads: number }[]) =>
  searches.length
    ? 'Searches available as lead sources (pick by id):\n' +
      searches.map((s) => `- id ${s.id}: "${s.label}" (${s.leads} leads)`).join('\n')
    : 'No searches exist yet — return an empty source_search_ids.'

/** The structured-output call drafting and revising share, plus the checks on what came back. */
async function writeCampaign(
  system: string,
  content: string,
  links: string[],
): Promise<CampaignDraft> {
  const message = await anthropic().messages.parse({
    model: MODEL.campaign,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(CampaignDraft) },
    system,
    messages: [{ role: 'user', content }],
  })
  guardRefusal(message)
  if (!message.parsed_output) throw new Error('Claude returned no campaign draft')
  const draft = message.parsed_output
  // Belt to the prompt's braces. An empty ICP is not a partial draft the user can fix by
  // editing — it is the one field that decides whether the campaign does anything at all,
  // so fail loudly here rather than hand back a campaign that silently never sends.
  if (!draft.icp.trim()) {
    throw new Error('Claude returned a campaign with no targeting rubric — try again')
  }
  return {
    ...draft,
    name: decodeEscapes(draft.name),
    icp: decodeEscapes(draft.icp),
    offer: decodeEscapes(draft.offer),
    guidelines: decodeEscapes(draft.guidelines),
    steps: draft.steps.map((step) => ({ ...step, goal: decodeEscapes(step.goal) })),
    links,
  }
}

/** Drafts every campaign field from a brief and any links, for the user to edit. */
export async function draftCampaign(args: {
  brief: string
  links: string[]
  senderName: string
  searches: { id: number; label: string; leads: number }[]
  report?: Report
}): Promise<CampaignDraft> {
  const report = args.report ?? (() => {})
  const sources = await readSources(args.brief, args.links, report)
  report({ phase: 'Writing the targeting, offer and sequence' })

  return writeCampaign(
    CAMPAIGN_SYSTEM,
    [
      `Emails will be signed by ${args.senderName}.`,
      `What the user asked for:\n${args.brief}`,
      args.links.length ? `Links to point at:\n${args.links.join('\n')}` : '',
      searchList(args.searches),
      `Research:\n${sources}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    args.links,
  )
}

const REVISE_SYSTEM = [
  CAMPAIGN_SYSTEM,
  '',
  'You are ADJUSTING a campaign that already exists. Every rule above still applies to what',
  'you return, and these as well:',
  '- Return the campaign complete, every field filled. Anything the instruction does not ask',
  '  about comes back exactly as it is now, word for word. This is an edit, not a rewrite —',
  '  the user is going to read your output as a diff against what they had.',
  '- Apply the instruction as narrowly as it is written. "Make the tone warmer" touches the',
  '  guidelines and perhaps the step goals; it does not touch the ICP, the offer or the links.',
  '- Never empty a field to satisfy an instruction. If following it literally would leave the',
  '  ICP, the offer or the sequence blank, keep what is there and apply the rest.',
  '- If the instruction is too vague to act on, return the campaign unchanged.',
].join('\n')

/** Applies a plain-language change ("actually, drop the third email") to an existing campaign. */
export async function reviseCampaign(args: {
  campaign: Campaign
  instruction: string
  links: string[]
  senderName: string
  searches: { id: number; label: string; leads: number }[]
  report?: Report
}): Promise<CampaignDraft> {
  const report = args.report ?? (() => {})
  const campaign = args.campaign

  // Research is the expensive half of a draft, and a revision already has last time's
  // research baked into the offer. Only pay for it again when the instruction points
  // somewhere genuinely new.
  const sources = args.links.length ? await readSources(args.instruction, args.links, report) : ''
  report({ phase: 'Revising the campaign' })

  const links = [...new Set([...(campaign.links ?? []), ...args.links])]
  const current = {
    name: campaign.name,
    language: campaign.language,
    source_search_ids: campaign.source_search_ids,
    min_score: campaign.min_score,
    icp: campaign.icp,
    offer: campaign.offer,
    guidelines: campaign.guidelines,
    steps: campaign.steps,
  }

  return writeCampaign(
    REVISE_SYSTEM,
    [
      `Emails will be signed by ${args.senderName}.`,
      `The campaign as it stands today:\n${JSON.stringify(current, null, 2)}`,
      `Links it points at:\n${links.join('\n') || '(none)'}`,
      searchList(args.searches),
      `The change the user asked for:\n${args.instruction}`,
      sources ? `Research on the newly given links:\n${sources}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    links,
  )
}

/* ------------------------------------------------------------- lead search */

/** The option lists are runtime data, so the tuple type z.enum wants has to be asserted. */
const oneOf = (values: readonly string[]) => z.enum(values as unknown as [string, ...string[]])
const valuesOf = (options: Option[]) => options.map((option) => option.value)

/** 'any' rather than an optional field: structured output wants every key present. */
const REVENUE_CHOICES = ['any', ...REVENUE]

const SearchDraft = z.object({
  // No max(): a long label is cosmetic and the field is editable, but a length
  // constraint that fails validation throws away the whole draft.
  label: z
    .string()
    .describe("Internal label for this search, aim for under 40 characters, in the user's language."),
  contact_job_title: z
    .array(z.string())
    .describe(
      'Job titles, matched as text against the title on the profile. Give the local-language ' +
        'variants for the target market first, then the common English ones. Five to fifteen: ' +
        'too few misses people, and a title nobody holds costs nothing.',
    ),
  contact_not_job_title: z
    .array(z.string())
    .describe('Titles to exclude — interns, students, assistants, anyone who cannot buy.'),
  seniority_level: z.array(oneOf(valuesOf(SENIORITY))),
  functional_level: z.array(oneOf(valuesOf(FUNCTION))),
  contact_location: z
    .array(z.string())
    .describe(
      'Countries, states or regions in lowercase English as Apify spells them ("sweden", ' +
        '"norway"). Anything more local than a region belongs in contact_city instead.',
    ),
  contact_city: z.array(z.string()).describe('Lowercase city names, local spelling ("göteborg").'),
  company_industry: z.array(oneOf(INDUSTRIES)),
  company_keywords: z
    .array(z.string())
    .describe('Words that should appear in the company description. Lowercase, few, specific.'),
  company_not_keywords: z.array(z.string()),
  size: z.array(oneOf(valuesOf(COMPANY_SIZE))),
  min_revenue: oneOf(REVENUE_CHOICES),
  max_revenue: oneOf(REVENUE_CHOICES),
  email_status: z.array(oneOf(valuesOf(EMAIL_STATUS))),
})

export type SearchDraft = z.infer<typeof SearchDraft>

/** Drafts the Apify filter set from a plain-language brief, for the user to edit. */
export async function draftSearch(args: {
  brief: string
  links: string[]
  report?: Report
}): Promise<SearchDraft> {
  const report = args.report ?? (() => {})
  // Pages are only worth fetching when the user pasted some; a description needs no web pass.
  // readSources is written for campaigns, so the brief carries the steer: price and terms
  // decide nothing here, and left to itself it goes looking for them.
  const sources = args.links.length
    ? await readSources(
        `${args.brief}\n\nWhat matters is who buys this: the roles that decide, the industries ` +
          'they work in and the size of company. Price, terms and campaign offers are irrelevant ' +
          'here — do not go looking for them.',
        args.links,
        report,
      )
    : ''
  report({ phase: 'Choosing the filters' })

  const message = await anthropic().messages.parse({
    model: MODEL.campaign,
    max_tokens: 8000,
    output_config: { format: zodOutputFormat(SearchDraft) },
    system: [
      'You fill in the filters for a B2B contact search that costs money to run and returns',
      'nothing useful when over-filtered. Every field is ANDed with the others, so each field',
      'you fill shrinks the result set: be generous inside a field, sparing across fields.',
      '',
      'An empty array means no filter on that field, which is usually the right answer. Fill a',
      'field only when the brief actually implies it.',
      '',
      'What people get wrong here:',
      '- Job titles, seniority and department all at once. The titles already encode the',
      '  seniority. Add seniority or department only when the titles alone would drag in people',
      '  who cannot buy, and then keep them wide.',
      '- English-only job titles. Titles are matched as text against the profile, and people at',
      '  Swedish companies write theirs in Swedish, so "Design Engineer" on its own never finds',
      '  the "Konstruktör" and "Maskinkonstruktör" who make up most of that market. List the',
      '  local-language titles for the target market alongside the English ones, including the',
      '  compound forms the language builds ("maskinkonstruktör", "produktionschef").',
      '- Revenue. The underlying data is patchy, so a revenue floor silently drops every company',
      '  with no figure on file. Leave both at "any" unless the brief names a size in money.',
      '- Location and city together. Pick the level the brief is written at, not both.',
      '- Industries by association. The list is fixed and narrow: pick the two to five entries',
      '  that really cover the buyers, not everything adjacent to the topic.',
      '',
      'email_status: validated only. Unverified addresses bounce, and bounces cost the sending',
      'domain more than the extra leads are worth.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Who the user wants to reach:\n${args.brief}`,
          sources ? `What the pages they gave say:\n${sources}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  })
  guardRefusal(message)
  if (!message.parsed_output) throw new Error('Claude returned no search filters')
  const draft = message.parsed_output
  const text = (values: string[]) => values.map(decodeEscapes)
  // The prompt says not to stack seniority and department on top of job titles, and the model
  // still does it now and then. The titles already encode the seniority, and every extra field
  // is ANDed, so this only ever drops people whose seniority Apify has no value for.
  const stacked = draft.contact_job_title.length > 0
  return {
    ...draft,
    seniority_level: stacked ? [] : draft.seniority_level,
    functional_level: stacked ? [] : draft.functional_level,
    label: decodeEscapes(draft.label),
    contact_job_title: text(draft.contact_job_title),
    contact_not_job_title: text(draft.contact_not_job_title),
    contact_location: matchLocations(draft.contact_location),
    contact_city: text(draft.contact_city),
    company_keywords: text(draft.company_keywords),
    company_not_keywords: text(draft.company_not_keywords),
  }
}
