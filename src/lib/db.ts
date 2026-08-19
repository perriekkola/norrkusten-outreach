import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

let cached: NeonQueryFunction<false, false> | null = null

/** Lazy so the app builds (and shows a useful error) before DATABASE_URL exists. */
export function db(): NeonQueryFunction<false, false> {
  if (!cached) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set — add it in Vercel or .env.local')
    cached = neon(url)
  }
  return cached
}

export const jsonb = (value: unknown) => JSON.stringify(value ?? null)

export type Search = {
  id: number
  label: string
  input: Record<string, unknown>
  run_id: string | null
  dataset_id: string | null
  status: 'running' | 'ready' | 'failed'
  imported: number
  error: string | null
  created_at: string
}

export type Lead = {
  id: number
  search_id: number | null
  email: string
  first_name: string | null
  last_name: string | null
  full_name: string | null
  job_title: string | null
  seniority: string | null
  linkedin: string | null
  phone: string | null
  city: string | null
  country: string | null
  company_name: string | null
  company_domain: string | null
  company_website: string | null
  company_linkedin: string | null
  company_size: string | null
  industry: string | null
  company_description: string | null
  raw: Record<string, unknown>
  research: string | null
  status: string
  created_at: string
}

export type Enrollment = {
  id: number
  campaign_id: number
  lead_id: number
  step: number
  status: 'active' | 'done' | 'replied' | 'stopped' | 'bounced'
  next_send_at: string
  /** Scored against this campaign's ICP, not a global one. */
  score: number | null
  verdict: string | null
  reasons: string | null
  angle: string | null
  created_at: string
}

export type CampaignStep = { delay_days: number; goal: string }

export type Mailbox = {
  id: number
  name: string
  from_email: string
  reply_to: string | null
  smtp_host: string
  smtp_port: number
  smtp_user: string
  /** Encrypted at rest; never send this to the client. */
  smtp_pass: string
  /** Appended to every email from this mailbox. The model is told not to sign off. */
  signature: string
  imap_host: string | null
  imap_port: number
  is_default: boolean
  created_at: string
}

export type Campaign = {
  id: number
  name: string
  icp: string
  offer: string
  language: string
  from_name: string | null
  auto_send: boolean
  /** Searches this campaign pulls leads from. */
  source_search_ids: number[]
  /** Leads below this never get drafted or sent. */
  min_score: number
  /** Extra drafting rules for this campaign — tone, what to ask for, what to avoid. */
  guidelines: string
  /** Pages the emails should point at. Several when a campaign pitches more than one course. */
  links: string[]
  /** Which mailbox sends this campaign. Null falls back to the default mailbox. */
  mailbox_id: number | null
  steps: CampaignStep[]
  status: 'active' | 'paused'
  created_at: string
}

export type Message = {
  id: number
  enrollment_id: number
  lead_id: number
  step: number
  subject: string
  body: string
  status: 'draft' | 'approved' | 'sent' | 'failed' | 'skipped'
  provider_id: string | null
  error: string | null
  sent_at: string | null
  opened_at: string | null
  click_count: number
  clicked_at: string | null
  replied_at: string | null
  created_at: string
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const rows = (await db()`select value from settings where key = ${key}`) as { value: string }[]
  return rows[0]?.value ?? fallback
}

export async function setSetting(key: string, value: string) {
  await db()`
    insert into settings (key, value) values (${key}, ${value})
    on conflict (key) do update set value = excluded.value`
}
