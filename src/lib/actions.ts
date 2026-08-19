'use server'

import { redirect } from 'next/navigation'
import { refresh } from 'next/cache'
import { describeApiError, draftCampaign } from './ai'
import { startRun, abortRun, type LeadSearchInput } from './apify'
import {
  checkPassword,
  endSession,
  hashPassword,
  requireUser,
  startSession,
  userCount,
} from './auth'
import { db, getSetting, jsonb, setSetting, type CampaignStep } from './db'
import { draftForEnrollment, ingestSearches, runCampaign, sendMessage, tick } from './engine'

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
    console.error('search start failed', error)
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
type DraftState = State & { draft?: import('./ai').CampaignDraft }

/** Reads the pasted links, then drafts every campaign field for the user to edit. */
export async function generateCampaign(_prev: DraftState, formData: FormData): Promise<DraftState> {
  await requireUser()
  const brief = String(formData.get('brief') ?? '').trim()
  if (!brief) return { error: 'Describe what you want to sell, or paste a course link.' }

  // Anything that looks like a URL in the brief is a page to read.
  const links = [...brief.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => match[0])

  try {
    const searches = (await db()`
      select s.id, s.label, count(l.id)::int as leads
        from searches s left join leads l on l.search_id = s.id
       group by s.id, s.label having count(l.id) > 0
       order by s.created_at desc`) as { id: number; label: string; leads: number }[]

    const draft = await draftCampaign({
      brief,
      links,
      senderName: (await getSetting('sender_name')) || 'Norrkusten',
      searches,
    })
    return { ok: 'Drafted. Read every field before creating — it can get things wrong.', draft }
  } catch (error) {
    console.error('campaign draft failed', error)
    return { error: describeApiError(error) }
  }
}

/** One bounded pass: enrol, score, draft. Reports what it did and what is left. */
export async function runCampaignNow(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const pass = await runCampaign(Number(formData.get('campaignId')))
  refresh()

  const did = [
    pass.enrolled && `enrolled ${pass.enrolled}`,
    pass.scored && `scored ${pass.scored}`,
    pass.drafted && `drafted ${pass.drafted}`,
  ].filter(Boolean)

  const left = [
    pass.unscored && `${pass.unscored} still unscored`,
    pass.due && `${pass.due} still to draft`,
  ].filter(Boolean)

  if (!did.length && !left.length) return { ok: 'Nothing to do — everything is up to date.' }

  return {
    ok: [
      did.length ? did.join(', ') : 'Nothing new to do',
      left.length ? `${left.join(' and ')} — run again to continue` : null,
      pass.failed ? `${pass.failed} failed: ${pass.reason}` : null,
    ]
      .filter(Boolean)
      .join('. '),
  }
}

/** Removes everything the last qualification scored below the bar. */
export async function dropWeak(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  const [campaign] = (await db()`select min_score from campaigns where id = ${campaignId}`) as {
    min_score: number
  }[]
  const floor = Number(formData.get('floor')) || campaign?.min_score || 50
  await db()`
    delete from enrollments
     where campaign_id = ${campaignId} and score is not null and score < ${floor}::int
       and status = 'active'
       and id not in (select enrollment_id from messages where status = 'sent')`
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
    sources: formData.getAll('source_search_ids').map(Number).filter(Number.isFinite),
    minScore: Math.max(0, Math.min(100, Number(formData.get('min_score')) || 0)),
    guidelines: String(formData.get('guidelines') ?? ''),
    links: formData
      .getAll('links')
      .map((value) => String(value).trim())
      .filter(Boolean),
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
             source_search_ids = ${values.sources}::int[], min_score = ${values.minScore},
             guidelines = ${values.guidelines}, links = ${values.links}::text[],
             language = ${values.language},
             from_name = ${values.from_name}, auto_send = ${values.auto_send},
             steps = ${values.steps}::jsonb
       where id = ${id}`
    refresh()
    return { ok: 'Saved.' }
  }

  const [created] = (await db()`
    insert into campaigns
      (name, icp, offer, source_search_ids, min_score, guidelines, links, language,
       from_name, auto_send, steps)
    values (${values.name}, ${values.icp}, ${values.offer}, ${values.sources}::int[],
            ${values.minScore}, ${values.guidelines}, ${values.links}::text[], ${values.language},
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
