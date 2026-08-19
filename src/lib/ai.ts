import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { Campaign, Lead } from './db'

const MODEL = 'claude-opus-5'

let client: Anthropic | null = null
function anthropic() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set')
    client = new Anthropic()
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
    model: MODEL,
    max_tokens: 4000,
    output_config: { effort: 'low', format: zodOutputFormat(Qualification) },
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
        'Return a short brief (max 200 words) with: what they do, recent news or hiring signals ' +
        'from the last 12 months, anything suggesting a need for staff training or upskilling, ' +
        'and one concrete, specific detail worth referencing in a first email. ' +
        'If the web results are thin, say so plainly instead of guessing.',
    },
  ]

  // Server tools can pause the turn; continue until Claude finishes (bounded).
  for (let attempt = 0; attempt < 4; attempt++) {
    const message = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 8000,
      output_config: { effort: 'low' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6 }],
      messages,
    })
    guardRefusal(message)
    if (message.stop_reason !== 'pause_turn') return textOf(message.content)
    messages.push({ role: 'assistant', content: message.content })
  }
  throw new Error('Research did not finish — try again')
}

/* -------------------------------------------------------------------- draft */

const Draft = z.object({
  subject: z.string().describe('Short, specific, lowercase-ish. No emoji, no "Re:" fakery.'),
  body: z.string().describe('Plain text email body including greeting and sign-off. No markdown.'),
})

export type Draft = z.infer<typeof Draft>

export async function draftEmail(args: {
  lead: Lead
  campaign: Campaign
  step: number
  senderName: string
  previous: { subject: string; body: string }[]
}): Promise<Draft> {
  const { lead, campaign, step, senderName, previous } = args
  const goal = campaign.steps[step]?.goal ?? 'A brief, polite follow-up.'
  const language = campaign.language === 'sv' ? 'Swedish' : campaign.language

  const thread = previous.length
    ? previous
        .map((m, i) => `--- Email ${i + 1} (already sent)\nSubject: ${m.subject}\n${m.body}`)
        .join('\n\n')
    : '(none — this is the first touch)'

  const message = await anthropic().messages.parse({
    model: MODEL,
    max_tokens: 8000,
    output_config: { format: zodOutputFormat(Draft) },
    system:
      `Write cold outreach emails in ${language} for ${senderName}, who sells e-learning courses. ` +
      'Rules: under 120 words. No flattery, no "I hope this email finds you well", no buzzwords, ' +
      'no fake urgency. Reference something concrete and true about the recipient or their ' +
      'company from the material provided — never invent facts, and if the research is thin, ' +
      'keep it general rather than fabricating. One clear, low-friction ask. Sign off as ' +
      `${senderName}. Plain text only.`,
    messages: [
      {
        role: 'user',
        content: [
          `What we sell:\n${campaign.offer}`,
          `Goal of this email (step ${step + 1} of ${campaign.steps.length}):\n${goal}`,
          `Lead:\n${leadContext(lead)}`,
          `Qualification angle: ${lead.angle ?? '—'}`,
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
