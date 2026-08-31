'use server'

import { redirect } from 'next/navigation'
import { refresh } from 'next/cache'
import { describeApiError } from './ai'
import { startRun, abortRun, type LeadSearchInput } from './apify'
import { ACTOR_MAX_LEADS, DEFAULT_LEADS } from './apify-options'
import {
  checkPassword,
  endSession,
  hashPassword,
  requireUser,
  startSession,
  userCount,
} from './auth'
import { db, jsonb, setSetting, type CampaignStep, type Mailbox } from './db'
import { forgetMailbox, sendEmail, verifyMailbox } from './email'
import { encrypt } from './secrets'
import { LEAD_IS_SUPPRESSED, suppress, unsuppress } from './suppression'
import { leadFilter } from './leads'
import { draftForEnrollment, ingestSearches, sendMessage, tick } from './engine'

/** Something a save needs to ask about afterwards, rather than decide on its own. */
export type FollowUp =
  | { kind: 'rescore'; campaignId: number; stale: number }
  | { kind: 'replaceDrafts'; campaignId: number; pending: number }

type State = {
  error?: string
  ok?: string
  /** Changes every save, so the form knows a fresh set of questions arrived. */
  followUpId?: string
  followUps?: FollowUp[]
}

const list = (value: FormDataEntryValue | null) =>
  String(value ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)

const ids = (formData: FormData) =>
  formData.getAll('leadId').map((v) => Number(v)).filter((n) => Number.isFinite(n))


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

export async function saveSendingLimits(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  // Clamped, not merely validated: 50/day/mailbox is where domain reputation damage
  // starts climbing, and a typo of 400 in this box is a burnt sending domain.
  const cap = Math.max(1, Math.min(50, Number(formData.get('daily_send_cap')) || 40))
  const cooldown = Math.max(0, Math.min(30, Number(formData.get('lead_cooldown_days')) || 0))
  // No upper bound worth enforcing: slower is always safe, and the ceiling belongs to
  // whoever hosts the mailbox, not to us.
  const spacing = Math.max(0, Math.min(120, Number(formData.get('send_spacing_seconds')) || 0))
  await setSetting('daily_send_cap', String(cap))
  await setSetting('lead_cooldown_days', String(cooldown))
  const rounds = Math.max(1, Math.min(48, Number(formData.get('rounds_per_day')) || 2))
  await setSetting('send_spacing_seconds', String(spacing))
  await setSetting('rounds_per_day', String(rounds))
  refresh()
  return {
    ok:
      `Saved. ${cap} a day per mailbox, about ${Math.ceil(cap / rounds)} per round ` +
      `across ${rounds} rounds, ${spacing}s between emails.`,
  }
}

/* --------------------------------------------------------------- suppression */

export async function addSuppression(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const raw = String(formData.get('email') ?? '').trim()
  if (!raw.includes('@')) return { error: 'Enter an address, or @domain.se for a whole company.' }
  try {
    const stopped = await suppress(raw, String(formData.get('reason') ?? '').trim(), 'manual')
    refresh()
    return {
      ok: stopped
        ? `Blocked. ${stopped} lead${stopped === 1 ? '' : 's'} removed from every campaign.`
        : 'Blocked. Nothing in the pool matched, so nothing was in flight.',
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function removeSuppression(formData: FormData) {
  await requireUser()
  await unsuppress(String(formData.get('email') ?? ''))
  refresh()
}

/* ---------------------------------------------------------------- mailboxes */

export async function saveMailbox(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const id = Number(formData.get('id')) || null
  const name = String(formData.get('name') ?? '').trim()
  const fromEmail = String(formData.get('from_email') ?? '').trim()
  const smtpUser = String(formData.get('smtp_user') ?? '').trim()
  const password = String(formData.get('smtp_pass') ?? '')

  if (!name || !fromEmail || !smtpUser) return { error: 'Name, from address and username are required.' }
  if (!id && !password) return { error: 'A password is required.' }

  const values = {
    name,
    fromEmail,
    replyTo: String(formData.get('reply_to') ?? '').trim() || null,
    smtpHost: String(formData.get('smtp_host') ?? '').trim(),
    smtpPort: Number(formData.get('smtp_port')) || 465,
    smtpUser,
    imapHost: String(formData.get('imap_host') ?? '').trim() || null,
    imapPort: Number(formData.get('imap_port')) || 993,
    signature: String(formData.get('signature') ?? ''),
    isDefault: formData.get('is_default') === 'on',
  }

  if (id) {
    await db()`
      update mailboxes
         set name = ${values.name}, from_email = ${values.fromEmail}, reply_to = ${values.replyTo},
             smtp_host = ${values.smtpHost}, smtp_port = ${values.smtpPort},
             smtp_user = ${values.smtpUser}, signature = ${values.signature},
             imap_host = ${values.imapHost},
             imap_port = ${values.imapPort}, is_default = ${values.isDefault}
       where id = ${id}`
    // Only overwrite the password when a new one was typed — the field is never prefilled.
    if (password) await db()`update mailboxes set smtp_pass = ${encrypt(password)} where id = ${id}`
    forgetMailbox(id)
  } else {
    await db()`
      insert into mailboxes
        (name, from_email, reply_to, smtp_host, smtp_port, smtp_user, smtp_pass, signature,
         imap_host, imap_port, is_default)
      values (${values.name}, ${values.fromEmail}, ${values.replyTo}, ${values.smtpHost},
              ${values.smtpPort}, ${values.smtpUser}, ${encrypt(password)}, ${values.signature},
              ${values.imapHost}, ${values.imapPort}, ${values.isDefault})`
  }

  // Exactly one default, always.
  if (values.isDefault) {
    await db()`
      update mailboxes set is_default = (id = coalesce(${id}::int,
        (select max(id) from mailboxes)))`
  }

  refresh()
  return { ok: 'Saved.' }
}

export async function testMailbox(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const [mailbox] = (await db()`
    select * from mailboxes where id = ${Number(formData.get('id'))}`) as Mailbox[]
  if (!mailbox) return { error: 'Mailbox not found.' }
  try {
    await verifyMailbox(mailbox)
    return { ok: `${mailbox.smtp_host} accepted the credentials.` }
  } catch (error) {
    return { error: `Could not sign in: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function deleteMailbox(formData: FormData) {
  await requireUser()
  const id = Number(formData.get('id'))
  await db()`delete from mailboxes where id = ${id}`
  forgetMailbox(id)
  refresh()
}

/* ----------------------------------------------------------------- searches */

export async function createSearch(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const label = String(formData.get('label') ?? '').trim() || 'Search'
  const count = Number(formData.get('fetch_count') ?? DEFAULT_LEADS)

  const input: LeadSearchInput = {
    file_name: label,
    // The actor's own schema sets no maximum and defaults to 100 000, so this ceiling is
    // ours, not theirs. It is a ceiling, not an order: billing is per lead returned.
    fetch_count:
      Number.isFinite(count) && count > 0 ? Math.min(count, ACTOR_MAX_LEADS) : DEFAULT_LEADS,
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
 * Drops everything the last qualification scored below the bar.
 *
 * Marked rather than deleted, and that is the whole point. A campaign re-enrols from its
 * source searches on every pass and only skips people who already have a row, so deleting
 * these put them straight back on the next run — with score = null, to be scored again at
 * full price, dropped again, and re-added again. Keeping the row ends the loop.
 */
export async function dropWeak(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  const [campaign] = (await db()`select min_score from campaigns where id = ${campaignId}`) as {
    min_score: number
  }[]
  const floor = Number(formData.get('floor')) || campaign?.min_score || 50
  await db()`
    update enrollments set status = 'removed'
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

/**
 * What to press when someone replies "take us off your list". Deleting them is not
 * enough — the address has to go on the suppression list, or the next search that
 * matches them puts them straight back into a campaign.
 */
export async function blockLeads(formData: FormData) {
  await requireUser()
  const rows = (await db()`
    select email from leads where id = any(${ids(formData)}::int[])`) as { email: string }[]
  // ponytail: one full pass over `leads` per address. Fine for the handful anyone blocks
  // by hand; if this is ever pointed at a select-all of thousands, suppress in bulk.
  for (const row of rows) {
    await suppress(row.email, 'Blocked from the leads list', 'manual')
  }
  refresh()
}

/**
 * Enrol either the ticked rows, or everything matching the current filter.
 *
 * The second mode exists because the ticked rows can only ever be the ones the page
 * rendered — selecting "all" on a 100-row page of a 975-lead search silently enrolled 100.
 * Filter mode resolves the rows in the database instead, so what the user was shown as a
 * count is what they get. It also drops suppressed addresses, which the hand-picked path
 * leaves alone: bulk enrolling a whole search would otherwise spend scoring and research
 * money on people who asked us to stop, and send blocks them at the end anyway.
 */
export async function enrollLeads(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  if (!Number.isFinite(campaignId)) return

  if (formData.get('allMatching')) {
    const { where, params } = leadFilter({
      query: String(formData.get('q') ?? ''),
      source: Number(formData.get('source')) || null,
    })
    await db().query(
      `insert into enrollments (campaign_id, lead_id)
       select $3, l.id from leads l
        where ${where} and l.status not in ('rejected', 'bounced')
          and not ${LEAD_IS_SUPPRESSED}
       on conflict (campaign_id, lead_id) do update set status = 'active'
         where enrollments.status = 'removed'`,
      [...params, campaignId],
    )
    refresh()
    return
  }

  const leadIds = ids(formData)
  if (!leadIds.length) return
  await db()`
    insert into enrollments (campaign_id, lead_id)
    select ${campaignId}, id from leads where id = any(${leadIds}::int[])
    on conflict (campaign_id, lead_id) do update set status = 'active'
      where enrollments.status = 'removed'`
  refresh()
}

/* ---------------------------------------------------------------- campaigns */

/**
 * Both shapes are read and both are kept, whichever mode is active.
 *
 * The form submits the goal fields and the subject/body fields together, hiding the set
 * the current mode does not use. Keeping both means switching a campaign to fixed and back
 * again returns the goals you wrote, instead of quietly discarding them on the way out.
 * Only the fields the active mode needs decide whether a step counts as filled in.
 */
function parseSteps(formData: FormData, mode: string): CampaignStep[] {
  const delays = formData.getAll('step_delay').map(String)
  const goals = formData.getAll('step_goal').map(String)
  const subjects = formData.getAll('step_subject').map(String)
  const bodies = formData.getAll('step_body').map(String)

  const count = Math.max(goals.length, subjects.length, bodies.length)
  const steps: CampaignStep[] = []
  for (let i = 0; i < count; i++) {
    const step = {
      delay_days: Number(delays[i] ?? 0) || 0,
      goal: (goals[i] ?? '').trim(),
      subject: (subjects[i] ?? '').trim(),
      body: (bodies[i] ?? '').trim(),
    }
    const filled = mode === 'fixed' ? Boolean(step.subject && step.body) : Boolean(step.goal)
    if (filled) steps.push(step)
  }
  return steps
}

export async function saveCampaign(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const id = Number(formData.get('id')) || null
  const name = String(formData.get('name') ?? '').trim()
  if (!name) return { error: 'Name is required.' }

  // The single choke point every campaign goes through — AI draft, hand-typed, later edit.
  // A campaign saved without an ICP has nothing to score against, so scoring is skipped,
  // every enrollment keeps score = null, `score >= min_score` is never true and the campaign
  // silently drafts nothing forever. Refusing the save is the only guard that catches all
  // three paths.
  const icp = String(formData.get('icp') ?? '').trim()
  if (!icp) {
    return {
      error:
        'Who this campaign targets is required — it is the rubric every lead is scored ' +
        'against. Without it nothing is scored, and nothing is ever drafted or sent.',
    }
  }

  const writingMode = formData.get('writing_mode') === 'fixed' ? 'fixed' : 'ai'
  const steps = parseSteps(formData, writingMode)

  // Fixed campaigns send exactly what is typed here, so an empty step is not a draft to be
  // filled in later — it is an email that cannot be written when the sequence reaches it.
  if (writingMode === 'fixed' && !steps.length) {
    return {
      error:
        'A fixed campaign needs a subject and a body for every email, including the ' +
        'follow-ups. Fill those in, or switch back to letting Claude write them.',
    }
  }

  // Scoring runs once and never again, so a changed rubric leaves every existing score
  // measured against the old one. Read the previous state before the update overwrites it.
  const [before] = id
    ? ((await db()`
        select icp, writing_mode, steps from campaigns where id = ${id}`) as {
        icp: string
        writing_mode: string
        steps: CampaignStep[]
      }[])
    : []
  const icpChanged = Boolean(before) && before.icp.trim() !== icp
  // Any change to what goes out invalidates work already queued, not just the mode switch:
  // editing a fixed campaign's wording leaves the old wording sitting in the outbox.
  const wordingChanged =
    Boolean(before) &&
    (before.writing_mode !== writingMode ||
      (writingMode === 'fixed' &&
        JSON.stringify(before.steps.map((s) => [s.subject ?? '', s.body ?? ''])) !==
          JSON.stringify(steps.map((s) => [s.subject ?? '', s.body ?? '']))))

  const values = {
    name,
    icp,
    sources: formData.getAll('source_search_ids').map(Number).filter(Number.isFinite),
    minScore: Math.max(0, Math.min(100, Number(formData.get('min_score')) || 0)),
    mailboxId: Number(formData.get('mailbox_id')) || null,
    guidelines: String(formData.get('guidelines') ?? ''),
    links: formData
      .getAll('links')
      .map((value) => String(value).trim())
      .filter(Boolean),
    offer: String(formData.get('offer') ?? ''),
    language: String(formData.get('language') ?? 'sv'),
    from_name: String(formData.get('from_name') ?? '') || null,
    auto_send: formData.get('auto_send') === 'on',
    writingMode,
    steps: jsonb(steps),
  }

  if (id) {
    await db()`
      update campaigns
         set name = ${values.name}, icp = ${values.icp}, offer = ${values.offer},
             source_search_ids = ${values.sources}::int[], min_score = ${values.minScore},
             guidelines = ${values.guidelines}, links = ${values.links}::text[],
             mailbox_id = ${values.mailboxId},
             language = ${values.language},
             from_name = ${values.from_name}, auto_send = ${values.auto_send},
             writing_mode = ${values.writingMode}, steps = ${values.steps}::jsonb
       where id = ${id}`
    refresh()

    const followUps: FollowUp[] = []
    if (icpChanged) {
      const [stale] = (await db()`
        select count(*)::int as n from enrollments
         where campaign_id = ${id} and score is not null and status <> 'removed'`) as {
        n: number
      }[]
      if (stale.n > 0) followUps.push({ kind: 'rescore', campaignId: id, stale: stale.n })
    }
    if (wordingChanged) {
      const [pending] = (await db()`
        select count(*)::int as n from messages m
         join enrollments e on e.id = m.enrollment_id
        where e.campaign_id = ${id} and m.status in ('draft', 'approved')`) as { n: number }[]
      if (pending.n > 0) {
        followUps.push({ kind: 'replaceDrafts', campaignId: id, pending: pending.n })
      }
    }
    return followUps.length
      ? { ok: 'Saved.', followUpId: crypto.randomUUID(), followUps }
      : { ok: 'Saved.' }
  }

  const [created] = (await db()`
    insert into campaigns
      (name, icp, offer, source_search_ids, min_score, guidelines, links, mailbox_id,
       language, from_name, auto_send, writing_mode, steps)
    values (${values.name}, ${values.icp}, ${values.offer}, ${values.sources}::int[],
            ${values.minScore}, ${values.guidelines}, ${values.links}::text[], ${values.mailboxId},
            ${values.language}, ${values.from_name}, ${values.auto_send}, ${values.writingMode},
            ${values.steps}::jsonb)
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

/**
 * Clears the scores for a campaign so the next pass scores them against the current ICP.
 *
 * Nothing is scored here — the pass does that, 40 at a time, and the campaign's cost
 * estimate updates to show what it will run to. The verdict, reasons and angle go with the
 * score because all four come out of the same call; leaving them would show a strong-fit
 * badge next to no score.
 *
 * Anyone already emailed keeps their score. Re-scoring them could drop them under the
 * floor halfway through a sequence and cut off a conversation that is already running.
 */
export async function rescoreCampaign(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  if (!Number.isFinite(campaignId)) return
  await db()`
    update enrollments
       set score = null, verdict = null, reasons = null, angle = null
     where campaign_id = ${campaignId} and status <> 'removed'
       and id not in (select enrollment_id from messages where status = 'sent')`
  refresh()
}

/**
 * Throws away this campaign's unsent drafts so the new wording is what actually goes out.
 *
 * Only ever offered after a save that changed what the emails say. Deleting rather than
 * rewriting in place is what lets the next pass rebuild them — for a fixed campaign that
 * costs nothing and happens the moment you press Run now; for a written one it is the same
 * work the Rewrite button does. Anything already sent is left alone, because it has been.
 */
/**
 * Says this was never a reply, and puts the sequence back.
 *
 * Header rules catch out-of-office and bounces, but something will always slip through:
 * a receptionist forwarding, a ticketing system, a colleague looping themselves in. That
 * costs a lead, because a reply ends their sequence for good and nothing here noticed.
 *
 * The intent is set rather than cleared. The mailbox is polled over a two week window, so
 * simply blanking replied_at would let the very next round match the same email and mark
 * it replied again, and the button would appear to do nothing.
 */
export async function dismissReply(formData: FormData) {
  await requireUser()
  const messageId = Number(formData.get('messageId'))
  if (!Number.isFinite(messageId)) return

  const [message] = (await db()`
    select enrollment_id, lead_id from messages where id = ${messageId}`) as {
    enrollment_id: number
    lead_id: number
  }[]
  if (!message) return

  await db()`
    update messages
       set replied_at = null, reply_intent = 'not_a_reply', reply_summary = null
     where id = ${messageId}`
  await db()`
    update enrollments set status = 'active'
     where id = ${message.enrollment_id} and status = 'replied'`
  // Whatever was dropped when the "reply" landed goes back in the queue, unapproved, so
  // it is read once more before it goes anywhere.
  await db()`
    update messages set status = 'draft'
     where enrollment_id = ${message.enrollment_id} and status = 'skipped' and sent_at is null`
  await db()`
    update leads set status = 'contacted'
     where id = ${message.lead_id} and status = 'replied'
       and not exists (select 1 from messages m
                        where m.lead_id = ${message.lead_id} and m.replied_at is not null)`
  refresh()
}

export async function replaceDrafts(formData: FormData) {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  if (!Number.isFinite(campaignId)) return
  await db()`
    delete from messages
     where status in ('draft', 'approved')
       and enrollment_id in (select id from enrollments where campaign_id = ${campaignId})`
  refresh()
}

export async function deleteCampaign(formData: FormData) {
  await requireUser()
  await db()`delete from campaigns where id = ${Number(formData.get('id'))}`
  redirect('/campaigns')
}

/**
 * Takes one lead out of one campaign, for good.
 *
 * Marked, not deleted, for the reason in dropWeak: a deleted row is re-created by the very
 * next pass over the campaign's source searches, so "Remove" used to mean "remove until
 * tomorrow morning". The row stays, the enrol upsert skips it, and it is hidden from the
 * enrolled list so the button still does what it looks like it does.
 */
export async function unenroll(formData: FormData) {
  await requireUser()
  await db()`
    update enrollments set status = 'removed'
     where id = ${Number(formData.get('enrollmentId'))}`
  refresh()
}

/**
 * Ends one campaign's sequence for a lead who answered — this campaign only.
 *
 * Per enrollment on purpose. Replies detected over IMAP are matched by the In-Reply-To
 * header down to the exact message, so they already stop only the campaign that was
 * answered; doing this by lead would have made the manual path the blunter of the two.
 * To stop every campaign at once, block the address instead.
 */
export async function markEnrollmentReplied(formData: FormData) {
  await requireUser()
  const enrollmentId = Number(formData.get('enrollmentId'))
  if (!Number.isFinite(enrollmentId)) return

  await db()`
    update enrollments set status = 'replied' where id = ${enrollmentId} and status = 'active'`
  await db()`
    update messages set status = 'skipped'
     where enrollment_id = ${enrollmentId} and status in ('draft', 'approved')`
  await db()`
    update leads set status = 'replied'
     where id = (select lead_id from enrollments where id = ${enrollmentId})
       and status <> 'rejected'`
  refresh()
}

/* ------------------------------------------------------------------- outbox */

export async function generateDrafts(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const campaignId = Number(formData.get('campaignId'))
  const due = (await db()`
    select e.id from enrollments e join campaigns c on c.id = e.campaign_id
     where e.status = 'active' and e.next_send_at <= now() and e.score >= c.min_score
       and (${campaignId || null}::int is null or e.campaign_id = ${campaignId || null}::int)
     order by e.score desc nulls last, e.next_send_at limit 25`) as { id: number }[]

  if (!due.length) return { ok: 'Nothing due right now.' }

  let drafted = 0
  let failed = 0
  let reason = ''
  for (const enrollment of due) {
    try {
      if (await draftForEnrollment(enrollment.id)) drafted++
    } catch (error) {
      failed++
      if (!reason) reason = describeApiError(error)
      console.error('draft failed', enrollment.id, error)
    }
  }
  refresh()

  if (!failed) return { ok: `Drafted ${drafted}.` }
  return { error: `Drafted ${drafted}, ${failed} failed: ${reason}` }
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

/**
 * Send now overrides the pacing guards — the daily cap and the per-lead cooldown exist
 * to stop the cron blasting, and this is a person picking specific rows. The suppression
 * check inside sendMessage is not overridable, and must not become so.
 */
export async function sendNow(formData: FormData) {
  await requireUser()
  for (const id of formData.getAll('messageId').map(Number)) {
    try {
      await sendMessage(id, { force: true })
    } catch (error) {
      console.error('send failed', id, error)
    }
  }
  refresh()
}

/**
 * Sends a draft to an address of your choosing so you can see it in a real client.
 * Deliberately not tracked: no pixel, no rewritten links, no sent_at — a test must
 * not show up as an open, a click, or a delivery to the lead.
 */
export async function sendTestEmail(_prev: State, formData: FormData): Promise<State> {
  await requireUser()
  const to = String(formData.get('to') ?? '').trim()
  if (!to.includes('@')) return { error: 'Enter an address to send the test to.' }

  const id = Number(formData.get('id'))
  const [message] = (await db()`
    select m.subject, m.body, c.mailbox_id, c.language
      from messages m
      join enrollments e on e.id = m.enrollment_id
      join campaigns c on c.id = e.campaign_id
     where m.id = ${id}`) as {
    subject: string
    body: string
    mailbox_id: number | null
    language: string
  }[]
  if (!message) return { error: 'Draft not found.' }

  try {
    const sent = await sendEmail({
      to,
      subject: `[TEST] ${message.subject}`,
      body: message.body,
      // The id is passed for the opt-out notice only — a test has to show the footer the
      // lead would get — while `track: false` keeps the pixel and rewritten links out.
      messageId: id,
      track: false,
      language: message.language,
      mailboxId: message.mailbox_id,
    })
    await setSetting('test_email', to)
    return { ok: `Sent to ${to} from ${sent.mailbox}.` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
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
