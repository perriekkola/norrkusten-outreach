'use server'

import { redirect } from 'next/navigation'
import { refresh } from 'next/cache'
import { startRun, abortRun, type LeadSearchInput } from './apify'
import { qualifyLead, researchCompany } from './ai'
import {
  checkPassword,
  endSession,
  hashPassword,
  requireUser,
  startSession,
  userCount,
} from './auth'
import { db, jsonb, setSetting, type CampaignStep, type Lead } from './db'
import { draftForEnrollment, ingestSearches, sendMessage, tick } from './engine'

type State = { error?: string; ok?: string }

const list = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)

const ids = (formData: FormData) =>
  formData.getAll('leadId').map((v) => Number(v)).filter((n) => Number.isFinite(n))

/**
 * Bulk AI work runs inside one request, so it has to fit the function timeout.
 * Bounded concurrency + a hard cap keeps a 300-lead selection from blowing it.
 */
async function mapLimit<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        try {
          await work(item)
        } catch (error) {
          console.error('bulk item failed', error)
        }
      }
    }),
  )
}

const QUALIFY_BATCH = 40
const RESEARCH_BATCH = 15

/* --------------------------------------------------------------------- auth */

export async function signIn(_prev: State, formData: FormData): Promise<State> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!email || !password) return { error: 'Email and password are required.' }

  // First run: no users yet, so this creates the admin account.
  if ((await userCount()) === 0) {
    if (password.length < 10) return { error: 'Choose a password of at least 10 characters.' }
    const [user] = (await db()`
      insert into users (email, password_hash) values (${email}, ${await hashPassword(password)})
      returning id`) as { id: number }[]
    await startSession(user.id)
    redirect('/')
  }

  const [user] = (await db()`
    select id, password_hash from users where email = ${email}`) as {
    id: number
    password_hash: string
  }[]
  if (!user || !(await checkPassword(password, user.password_hash))) {
    return { error: 'Wrong email or password.' }
  }
  await startSession(user.id)
  redirect('/')
}

export async function signOut() {
  await endSession()
  redirect('/login')
}

export async function addUser(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  if (!email || password.length < 10) return { error: 'Email and a 10+ character password needed.' }
  try {
    await db()`
      insert into users (email, password_hash) values (${email}, ${await hashPassword(password)})`
  } catch {
    return { error: 'That email already has an account.' }
  }
  refresh()
  return { ok: `Added ${email}.` }
}

/* ----------------------------------------------------------------- settings */

export async function saveSettings(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  await setSetting('sender_name', String(formData.get('sender_name') ?? ''))
  refresh()
  return { ok: 'Saved.' }
}

/* ----------------------------------------------------------------- searches */

export async function createSearch(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const label = String(formData.get('label') ?? '').trim() || 'Search'
  const count = Number(formData.get('fetch_count') ?? 100)

  const input: LeadSearchInput = {
    file_name: label,
    fetch_count: Number.isFinite(count) && count > 0 ? Math.min(count, 50_000) : 100,
    contact_job_title: list(formData.get('contact_job_title')),
    contact_not_job_title: list(formData.get('contact_not_job_title')),
    seniority_level: formData.getAll('seniority_level').map(String),
    functional_level: formData.getAll('functional_level').map(String),
    contact_location: formData.getAll('contact_location').map(String),
    contact_city: list(formData.get('contact_city')),
    email_status: formData.getAll('email_status').map(String),
    size: formData.getAll('size').map(String),
    company_industry: formData.getAll('company_industry').map(String),
    company_keywords: list(formData.get('company_keywords')),
    company_not_keywords: list(formData.get('company_not_keywords')),
    min_revenue: String(formData.get('min_revenue') ?? '') || undefined,
    max_revenue: String(formData.get('max_revenue') ?? '') || undefined,
  }
  // Apify treats empty arrays as filters, so drop them.
  for (const key of Object.keys(input) as (keyof LeadSearchInput)[]) {
    const value = input[key]
    if (Array.isArray(value) && value.length === 0) delete input[key]
  }

  try {
    const run = await startRun(input)
    await db()`
      insert into searches (label, input, run_id, status)
      values (${label}, ${jsonb(input)}::jsonb, ${run.id}, 'running')`
  } catch (error) {
    return { error: String(error) }
  }
  refresh()
  return { ok: 'Search started. Results land here within a few minutes.' }
}

export async function refreshSearches() {
  await requireUser()
  await ingestSearches()
  refresh()
}

export async function cancelSearch(formData: FormData) {
  await requireUser()
  const id = Number(formData.get('id'))
  const [search] = (await db()`select run_id from searches where id = ${id}`) as {
    run_id: string | null
  }[]
  if (search?.run_id) await abortRun(search.run_id).catch(() => {})
  await db()`update searches set status = 'failed', error = 'Cancelled' where id = ${id}`
  refresh()
}

export async function deleteSearch(formData: FormData) {
  await requireUser()
  await db()`delete from searches where id = ${Number(formData.get('id'))}`
  refresh()
}

/* -------------------------------------------------------------------- leads */

/**
 * Scores enrolled leads against their campaign's own ICP. Scoring is per pairing:
 * the same lead can be strong for one campaign and weak for another.
 */
export async function qualifyEnrollments(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  const [campaign] = (await db()`select icp from campaigns where id = ${campaignId}`) as {
    icp: string
  }[]
  if (!campaign?.icp.trim()) return

  const explicit = formData.getAll('enrollmentId').map(Number).filter(Number.isFinite)
  const targets = explicit.length
    ? explicit
    : ((await db()`
        select id from enrollments
         where campaign_id = ${campaignId} and score is null
         order by created_at limit ${QUALIFY_BATCH}`) as { id: number }[]).map((row) => row.id)

  await mapLimit(targets.slice(0, QUALIFY_BATCH), 5, async (enrollmentId) => {
    const [row] = (await db()`
      select l.* from enrollments e join leads l on l.id = e.lead_id
       where e.id = ${enrollmentId}`) as Lead[]
    if (!row) return
    const result = await qualifyLead(row, campaign.icp)
    await db()`
      update enrollments
         set score = ${result.score}, verdict = ${result.verdict},
             reasons = ${result.reasons}, angle = ${result.angle}
       where id = ${enrollmentId}`
  })
  refresh()
}

/** Removes everything the last qualification scored below the bar. */
export async function dropWeak(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  const floor = Number(formData.get('floor')) || 50
  await db()`
    delete from enrollments
     where campaign_id = ${campaignId} and score is not null and score < ${floor}::int
       and status = 'active'
       and id not in (select enrollment_id from messages where status = 'sent')`
  refresh()
}

export async function researchLeads(formData: FormData) {
  await requireUser()
  await mapLimit(ids(formData).slice(0, RESEARCH_BATCH), 3, async (id) => {
    const [lead] = (await db()`select * from leads where id = ${id}`) as Lead[]
    if (!lead) return
    const brief = await researchCompany(lead)
    await db()`update leads set research = ${brief} where id = ${id}`
  })
  refresh()
}

export async function setLeadStatus(formData: FormData) {
  await requireUser()
  const status = String(formData.get('status'))
  const leadIds = ids(formData)
  await db()`update leads set status = ${status} where id = any(${leadIds}::int[])`
  if (status === 'replied') {
    await db()`
      update enrollments set status = 'replied'
       where lead_id = any(${leadIds}::int[]) and status = 'active'`
    await db()`
      update messages set status = 'skipped'
       where lead_id = any(${leadIds}::int[]) and status in ('draft', 'approved')`
  }
  refresh()
}

export async function deleteLeads(formData: FormData) {
  await requireUser()
  await db()`delete from leads where id = any(${ids(formData)}::int[])`
  refresh()
}

export async function enrollLeads(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  if (!Number.isFinite(campaignId)) return
  const leadIds = ids(formData)
  if (!leadIds.length) return
  await db()`
    insert into enrollments (campaign_id, lead_id)
    select ${campaignId}, id from leads where id = any(${leadIds}::int[])
    on conflict (campaign_id, lead_id) do nothing`
  refresh()
}

/* ---------------------------------------------------------------- campaigns */

function parseSteps(formData: FormData): CampaignStep[] {
  const delays = formData.getAll('step_delay').map(String)
  const goals = formData.getAll('step_goal').map(String)
  return goals
    .map((goal, i) => ({ delay_days: Number(delays[i] ?? 0) || 0, goal: goal.trim() }))
    .filter((step) => step.goal)
}

export async function saveCampaign(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const id = Number(formData.get('id')) || null
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Name is required.' }

  const values = {
    name,
    icp: String(formData.get('icp') ?? ''),
    offer: String(formData.get('offer') ?? ''),
    language: String(formData.get('language') ?? 'sv'),
    from_name: String(formData.get('from_name') ?? '') || null,
    auto_send: formData.get('auto_send') === 'on',
    steps: jsonb(parseSteps(formData)),
  }

  if (id) {
    await db()`
      update campaigns
         set name = ${values.name}, icp = ${values.icp}, offer = ${values.offer},
             language = ${values.language},
             from_name = ${values.from_name}, auto_send = ${values.auto_send},
             steps = ${values.steps}::jsonb
       where id = ${id}`
    refresh()
    return { ok: 'Saved.' }
  }

  const [created] = (await db()`
    insert into campaigns (name, icp, offer, language, from_name, auto_send, steps)
    values (${values.name}, ${values.icp}, ${values.offer}, ${values.language},
            ${values.from_name}, ${values.auto_send}, ${values.steps}::jsonb)
    returning id`) as { id: number }[]
  redirect(`/campaigns/${created.id}`)
}

export async function setCampaignStatus(formData: FormData) {
  await requireUser()
  await db()`
    update campaigns set status = ${String(formData.get('status'))}
     where id = ${Number(formData.get('id'))}`
  refresh()
}

export async function deleteCampaign(formData: FormData) {
  await requireUser()
  await db()`delete from campaigns where id = ${Number(formData.get('id'))}`
  redirect('/campaigns')
}

export async function unenroll(formData: FormData) {
  await requireUser()
  await db()`delete from enrollments where id = ${Number(formData.get('enrollmentId'))}`
  refresh()
}

/* ------------------------------------------------------------------- outbox */

export async function generateDrafts(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  const due = (await db()`
    select id from enrollments
     where status = 'active' and next_send_at <= now()
       and (${campaignId || null}::int is null or campaign_id = ${campaignId || null}::int)
     order by next_send_at limit 25`) as { id: number }[]
  await mapLimit(due, 4, (enrollment) => draftForEnrollment(enrollment.id).then(() => {}))
  refresh()
}

export async function updateDraft(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  await db()`
    update messages
       set subject = ${String(formData.get('subject') ?? '')},
           body = ${String(formData.get('body') ?? '')}
     where id = ${Number(formData.get('id'))} and status in ('draft', 'approved')`
  refresh()
  return { ok: 'Saved.' }
}

export async function approveMessages(formData: FormData) {
  await requireUser()
  const messageIds = formData.getAll('messageId').map(Number)
  await db()`
    update messages set status = 'approved'
     where id = any(${messageIds}::int[]) and status = 'draft'`
  refresh()
}

export async function sendNow(formData: FormData) {
  await requireUser()
  for (const id of formData.getAll('messageId').map(Number)) {
    try {
      await sendMessage(id)
    } catch (error) {
      console.error('send failed', id, error)
    }
  }
  refresh()
}

export async function discardMessages(formData: FormData) {
  await requireUser()
  await db()`
    update messages set status = 'skipped'
     where id = any(${formData.getAll('messageId').map(Number)}::int[]) and status <> 'sent'`
  refresh()
}

export async function runTick() {
  await requireUser()
  await tick()
  refresh()
}
