import 'server-only'

const ACTOR = 'code_crafter~leads-finder'
const API = 'https://api.apify.com/v2'

function token() {
  const value = process.env.APIFY_TOKEN
  if (!value) throw new Error('APIFY_TOKEN is not set')
  return value
}

/** Mirrors the actor's input schema (all fields optional). */
export type LeadSearchInput = {
  fetch_count?: number
  file_name?: string
  contact_job_title?: string[]
  contact_not_job_title?: string[]
  seniority_level?: string[]
  functional_level?: string[]
  contact_location?: string[]
  contact_city?: string[]
  contact_not_location?: string[]
  contact_not_city?: string[]
  email_status?: string[]
  company_domain?: string[]
  size?: string[]
  company_industry?: string[]
  company_not_industry?: string[]
  company_keywords?: string[]
  company_not_keywords?: string[]
  min_revenue?: string
  max_revenue?: string
  funding?: string[]
}

export type ApifyRun = {
  id: string
  status: 'READY' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED-OUT'
  defaultDatasetId: string
}

async function apify<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}token=${token()}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Apify ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<T>
}

/** Kicks off the actor without waiting — the cron picks up the results. */
export async function startRun(input: LeadSearchInput): Promise<ApifyRun> {
  const { data } = await apify<{ data: ApifyRun }>(`/acts/${ACTOR}/runs`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data
}

export async function getRun(runId: string): Promise<ApifyRun> {
  const { data } = await apify<{ data: ApifyRun }>(`/actor-runs/${runId}`)
  return data
}

export async function abortRun(runId: string): Promise<ApifyRun> {
  const { data } = await apify<{ data: ApifyRun }>(`/actor-runs/${runId}/abort`, { method: 'POST' })
  return data
}

export async function getDatasetItems(datasetId: string, limit = 10_000) {
  return apify<Record<string, unknown>[]>(`/datasets/${datasetId}/items?clean=true&limit=${limit}`)
}
