import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Campaign, Lead } from './db'

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
  return message.parsed_output
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
    if (message.stop_reason !== 'pause_turn') return finalText(message.content)
    messages.push({ role: 'assistant', content: message.content })
  }
  throw new Error('Research did not finish — try again')
}

/* -------------------------------------------------------------------- draft */

const Draft = z.object({
  subject: z
    .string()
    .describe('Sentence case, like a human typed it. Short and specific. No emoji, no fake "Re:".'),
  body: z.string().describe('Plain text email body including greeting and sign-off. No markdown.'),
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
      `You write cold outreach emails in ${language}, signed by ${senderName}.`,
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
      `- Sign off as ${senderName} and nothing else.`,
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
          campaign.links.length
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
  return message.parsed_output
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
    .describe(
      'The scoring rubric. Who is a strong fit (75-100), medium (40-74) and poor (0-39), with ' +
        'reasons. The poor band must name competitors who sell the same thing, by name where ' +
        'known, or every lead scores high and the score floor is useless.',
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

/** Reads whatever the user pasted — links get fetched, claims get checked. */
async function readSources(brief: string, links: string[]): Promise<string> {
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
    if (message.stop_reason !== 'pause_turn') return finalText(message.content)
    messages.push({ role: 'assistant', content: message.content })
  }
  throw new Error('Reading the sources did not finish — try again')
}

/** Drafts every campaign field from a brief and any links, for the user to edit. */
export async function draftCampaign(args: {
  brief: string
  links: string[]
  senderName: string
  searches: { id: number; label: string; leads: number }[]
}): Promise<CampaignDraft> {
  const sources = await readSources(args.brief, args.links)

  const message = await anthropic().messages.parse({
    model: MODEL.campaign,
    max_tokens: 16000,
    output_config: { format: zodOutputFormat(CampaignDraft) },
    system: [
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
      '- If the source page makes a marketing superlative ("the most comprehensive in Sweden"),',
      '  record it in the offer as the page\'s claim, and forbid it in the guidelines. Repeating a',
      '  superlative to an engineer costs credibility.',
      '',
      'Two things people get wrong and you must not:',
      '- The ICP has to say who is a POOR fit, competitors who sell the same thing included, by',
      '  name where you know them. Without that band every lead scores high and the floor is dead.',
      '- The ask has to match the price. A self-serve product costing a few thousand kronor sends',
      '  people to the page to read and buy. It never asks for a meeting, a call or fifteen',
      '  minutes, and the guidelines must forbid those explicitly.',
      '',
      'Shape of the sequence: three emails is the default. Each one makes a different argument —',
      'if you cannot give a step its own argument, do not add the step. Do not write a fifth.',
      '',
      'Pick the source searches from the list given. Leaving that empty produces a campaign that',
      'silently does nothing, so only do it if no offered search could match the ICP at all.',
    ].join('\n'),
    messages: [
      {
        role: 'user',
        content: [
          `Emails will be signed by ${args.senderName}.`,
          `What the user asked for:\n${args.brief}`,
          args.links.length ? `Links to point at:\n${args.links.join('\n')}` : '',
          args.searches.length
            ? 'Searches available as lead sources (pick by id):\n' +
              args.searches.map((s) => `- id ${s.id}: "${s.label}" (${s.leads} leads)`).join('\n')
            : 'No searches exist yet — return an empty source_search_ids.',
          `Research:\n${sources}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
  })
  guardRefusal(message)
  if (!message.parsed_output) throw new Error('Claude returned no campaign draft')
  return { ...message.parsed_output, links: args.links }
}
