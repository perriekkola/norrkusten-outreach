import 'server-only'
import { getDatasetItems, getRun } from './apify'
import { describeApiError, draftEmailChecked, qualifyLead, researchCompany } from './ai'
import { db, getSetting, setSetting, jsonb, type Campaign, type Lead, type Message } from './db'
import { sendEmail } from './email'
import { fillTemplate, normalizeEmail } from './format'
import { checkReplies } from './replies'
import { LEAD_IS_SUPPRESSED, suppressedAmong } from './suppression'

const str = (row: Record<string, unknown>, key: string) => {
  const value = row[key]
  if (value === null || value === undefined || value === '') return null
  return String(value).slice(0, 2000)
}

/**
 * Apify rows -> leads. Unknown fields survive in `raw`.
 *
 * Two things stop a duplicate here, and both are needed. The unique index on
 * `leads.email` only fires once the address is normalised — a scraper handing back
 * ` Per@X.se ` and `per@x.se` would otherwise be two people. And the suppression list
 * is checked before the insert, because a lead who opted out and was then deleted
 * would otherwise walk straight back in through the next search.
 */
async function importDataset(searchId: number, rows: Record<string, unknown>[]) {
  const emails = rows
    .map((row) => normalizeEmail(str(row, 'email') ?? ''))
    .filter((email) => email.includes('@'))
  const blocked = await suppressedAmong(emails)

  let imported = 0
  for (const row of rows) {
    const email = normalizeEmail(str(row, 'email') ?? '')
    if (!email.includes('@') || blocked.has(email)) continue
    const result = (await db()`
      insert into leads (
        search_id, email, first_name, last_name, full_name, job_title, seniority, linkedin,
        phone, city, country, company_name, company_domain, company_website, company_linkedin,
        company_size, industry, company_description, raw
      ) values (
        ${searchId}, ${email}, ${str(row, 'first_name')}, ${str(row, 'last_name')},
        ${str(row, 'full_name')}, ${str(row, 'job_title')}, ${str(row, 'seniority_level')},
        ${str(row, 'linkedin')}, ${str(row, 'mobile_number')}, ${str(row, 'city')},
        ${str(row, 'country')}, ${str(row, 'company_name')}, ${str(row, 'company_domain')},
        ${str(row, 'company_website')}, ${str(row, 'company_linkedin')},
        ${str(row, 'company_size')}, ${str(row, 'industry')}, ${str(row, 'company_description')},
        ${jsonb(row)}::jsonb
      )
      on conflict (email) do nothing
      returning id`) as { id: number }[]
    if (result.length) imported++
  }
  return imported
}

/** Poll every in-flight Apify run and pull finished datasets into `leads`. */
export async function ingestSearches() {
  const searches = (await db()`
    select id, run_id from searches where status = 'running' and run_id is not null`) as {
    id: number
    run_id: string
  }[]

  for (const search of searches) {
    try {
      const run = await getRun(search.run_id)
      if (run.status === 'READY' || run.status === 'RUNNING') continue

      if (run.status !== 'SUCCEEDED') {
        await db()`update searches set status = 'failed', error = ${`Apify run ${run.status}`} where id = ${search.id}`
        continue
      }

      const rows = await getDatasetItems(run.defaultDatasetId)
      const imported = await importDataset(search.id, rows)
      await db()`
        update searches
           set status = 'ready', dataset_id = ${run.defaultDatasetId}, imported = ${imported}, error = null
         where id = ${search.id}`
    } catch (error) {
      await db()`update searches set status = 'failed', error = ${String(error)} where id = ${search.id}`
    }
  }
}

/** Create the draft for one enrollment's current step. Returns the message id. */
export async function draftForEnrollment(
  enrollmentId: number,
  report: (event: { phase: string; detail?: string }) => void = () => {},
): Promise<number | null> {
  // row_to_json rather than a column list: the list silently went stale when `links`
  // was added, campaign.links came back undefined, and every draft threw.
  const rows = (await db()`
    select e.step, e.lead_id, e.angle, row_to_json(c) as campaign
      from enrollments e join campaigns c on c.id = e.campaign_id
     where e.id = ${enrollmentId}`) as {
    step: number
    lead_id: number
    angle: string | null
    campaign: Campaign
  }[]
  const row = rows[0]
  if (!row) return null

  const campaign = row.campaign
  if (row.step >= campaign.steps.length) {
    await db()`update enrollments set status = 'done' where id = ${enrollmentId}`
    return null
  }

  const existing = (await db()`
    select id from messages where enrollment_id = ${enrollmentId} and step = ${row.step}`) as {
    id: number
  }[]
  if (existing.length) return existing[0].id

  const [lead] = (await db()`select * from leads where id = ${row.lead_id}`) as Lead[]
  if (!lead) return null

  // A fixed campaign has nothing to write. Returning here skips the research too, which is
  // the expensive half of a draft and would be paid for a paragraph nobody reads.
  if (campaign.writing_mode === 'fixed') {
    const step = campaign.steps[row.step]
    const subject = fillTemplate(step.subject ?? '', lead)
    const body = fillTemplate(step.body ?? '', lead)
    if (!subject.trim() || !body.trim()) {
      throw new Error(`Step ${row.step + 1} of "${campaign.name}" has no subject or body`)
    }
    report({ phase: 'Preparing', detail: lead.full_name || lead.email })
    const [fixed] = (await db()`
      insert into messages (enrollment_id, lead_id, step, subject, body, status)
      values (${enrollmentId}, ${lead.id}, ${row.step}, ${subject}, ${body},
              ${campaign.auto_send ? 'approved' : 'draft'})
      on conflict (enrollment_id, step) do update
        set subject = excluded.subject, body = excluded.body, status = excluded.status
      returning id`) as { id: number }[]
    return fixed.id
  }

  const previous = (await db()`
    select subject, body from messages
     where enrollment_id = ${enrollmentId} and status = 'sent' order by step`) as {
    subject: string
    body: string
  }[]

  // Research is an input to writing, not a step of its own: fetch it the first time we
  // write to this company and reuse it for every later email and every other campaign.
  if (!lead.research) {
    try {
      report({ phase: 'Researching', detail: lead.company_name ?? lead.email })
      lead.research = await researchCompany(lead)
      await db()`update leads set research = ${lead.research} where id = ${lead.id}`
    } catch (error) {
      console.error('research failed, drafting without it', lead.id, error)
    }
  }

  const senderName = campaign.from_name || 'Norrkusten'
  report({ phase: 'Writing to', detail: lead.full_name || lead.email })
  const draft = await draftEmailChecked({
    lead,
    campaign,
    step: row.step,
    senderName,
    angle: row.angle,
    previous,
  })

  const [message] = (await db()`
    insert into messages (enrollment_id, lead_id, step, subject, body, status)
    values (${enrollmentId}, ${lead.id}, ${row.step}, ${draft.subject}, ${draft.body},
            ${campaign.auto_send ? 'approved' : 'draft'})
    on conflict (enrollment_id, step) do update
      set subject = excluded.subject, body = excluded.body, status = excluded.status
    returning id`) as { id: number }[]
  return message.id
}

/**
 * How long a lead is left alone after any email from us, across every campaign. Five
 * active campaigns pulling from overlapping searches will happily pick the same person
 * five times; the recipient sees one sender sending five times, and it is their reaction
 * that sets our domain reputation, not our campaign structure.
 */
export const DEFAULT_LEAD_COOLDOWN_DAYS = 3

export const leadCooldownDays = async () =>
  Number(await getSetting('lead_cooldown_days', String(DEFAULT_LEAD_COOLDOWN_DAYS))) ||
  DEFAULT_LEAD_COOLDOWN_DAYS

/**
 * Is this the mail server saying "not now" rather than "never"?
 *
 * SMTP 4xx is explicitly temporary: 451 "Too many mails received within the last 5
 * minutes" means slow down and retry, not that the address is bad. Marking those failed
 * threw away 75 perfectly good emails in one run, because nothing ever retries a failed
 * message. A transient error leaves the message approved so the next round picks it up.
 */
function isTransientSendError(error: unknown): boolean {
  const code = (error as { responseCode?: number } | null)?.responseCode
  if (typeof code === 'number') return code >= 400 && code < 500
  return /too many|rate limit|try again|temporarily|timeout|ETIMEDOUT|ECONNRESET/i.test(
    String(error),
  )
}

export type SendOutcome = 'sent' | 'suppressed' | 'cooldown'

/**
 * Send one approved message and move its enrollment to the next step.
 *
 * `force` is the Send-now path: the user picked these rows deliberately, so the pacing
 * guards step aside. The suppression check never does — that one is the law, not a
 * deliverability preference.
 */
export async function sendMessage(
  messageId: number,
  options: { force?: boolean } = {},
): Promise<SendOutcome> {
  const [message] = (await db()`select * from messages where id = ${messageId}`) as Message[]
  if (!message || message.status === 'sent') return 'sent'

  const [row] = (await db()`
    select l.email, c.mailbox_id, c.language
      from messages m
      join leads l on l.id = m.lead_id
      join enrollments e on e.id = m.enrollment_id
      join campaigns c on c.id = e.campaign_id
     where m.id = ${message.id}`) as {
    email: string
    mailbox_id: number | null
    language: string
  }[]
  if (!row) throw new Error('Lead is gone')

  const [blocked] = (await db().query(
    `select 1 as hit from leads l where l.id = $1 and ${LEAD_IS_SUPPRESSED}`,
    [message.lead_id],
  )) as { hit: number }[]
  if (blocked) {
    await db()`
      update messages set status = 'skipped', error = 'Recipient is on the suppression list'
       where id = ${message.id}`
    await db()`
      update enrollments set status = 'stopped'
       where id = ${message.enrollment_id} and status = 'active'`
    return 'suppressed'
  }

  if (!options.force) {
    const days = await leadCooldownDays()
    const [recent] = (await db()`
      select 1 as hit from messages
       where lead_id = ${message.lead_id} and id <> ${message.id} and status = 'sent'
         and sent_at > now() - make_interval(days => ${days}::int) limit 1`) as { hit: number }[]
    if (recent) {
      // Hold the message rather than drop it: the campaign still wants this email sent,
      // just not on top of the one that went out yesterday.
      await db()`
        update enrollments
           set next_send_at = now() + make_interval(days => ${days}::int)
         where id = ${message.enrollment_id}`
      return 'cooldown'
    }
  }

  try {
    const sent = await sendEmail({
      to: row.email,
      subject: message.subject,
      body: message.body,
      messageId: message.id,
      mailboxId: row.mailbox_id,
      language: row.language,
    })
    await db()`
      update messages
         set status = 'sent', provider_id = ${sent.id}, sent_at = now(), error = null,
             mailbox_id = ${row.mailbox_id}
       where id = ${message.id}`
  } catch (error) {
    // Keep a throttled message approved. Recording the reason still surfaces it, but the
    // status is what decides whether it is ever tried again.
    const status = isTransientSendError(error) ? 'approved' : 'failed'
    await db()`
      update messages set status = ${status}, error = ${String(error)}
       where id = ${message.id}`
    throw error
  }

  await db()`update leads set status = 'contacted' where id = ${message.lead_id} and status = 'new'`

  // Schedule the next step, or finish the enrollment.
  const [enrollment] = (await db()`
    select e.id, e.step, c.steps
      from enrollments e join campaigns c on c.id = e.campaign_id
     where e.id = ${message.enrollment_id}`) as {
    id: number
    step: number
    steps: { delay_days: number }[]
  }[]
  if (!enrollment) return 'sent'

  const next = enrollment.step + 1
  if (next >= enrollment.steps.length) {
    await db()`update enrollments set status = 'done', step = ${next} where id = ${enrollment.id}`
    return 'sent'
  }
  const days = Number(enrollment.steps[next]?.delay_days ?? 3)
  await db()`
    update enrollments
       set step = ${next}, next_send_at = now() + make_interval(days => ${days}::int)
     where id = ${enrollment.id}`
  return 'sent'
}

/**
 * How many emails one mailbox may send in a day, and how many this pass may use.
 *
 * 30-50 per warmed mailbox per day is the accepted band; experienced senders sit at 40,
 * and above 50 domain-level reputation damage climbs sharply. A domain running three to
 * five mailboxes lands at 100-250/day, which is the other published ceiling — so capping
 * per mailbox gets both right without a second setting. The cron fires twice daily, so a
 * single pass takes half the day's allowance and leaves the rest for the other run.
 */
export const DEFAULT_DAILY_SEND_CAP = 40

export const dailySendCap = async () =>
  Number(await getSetting('daily_send_cap', String(DEFAULT_DAILY_SEND_CAP))) ||
  DEFAULT_DAILY_SEND_CAP

/**
 * How many times a day the schedule calls /api/cron.
 *
 * The day's allowance is divided by this, so more rounds means smaller batches rather
 * than more email. It used to be the literal number 2, which meant adding a third round
 * changed nothing: the first two took half the allowance each and the rest found none
 * left. Spreading the same volume over more of the day is the point.
 *
 * It has to be told, not counted, because the caller might be a GitHub Action or a
 * crontab rather than vercel.json. Keep it matching the real schedule.
 */
export const DEFAULT_ROUNDS_PER_DAY = 2

export const roundsPerDay = async () =>
  Math.max(
    1,
    Number(await getSetting('rounds_per_day', String(DEFAULT_ROUNDS_PER_DAY))) ||
      DEFAULT_ROUNDS_PER_DAY,
  )

/** Mailbox id (0 = the env fallback) -> how many more emails this pass may send from it. */
async function sendAllowance(): Promise<(mailboxId: number) => number> {
  const cap = await dailySendCap()
  const perPass = Math.ceil(cap / (await roundsPerDay()))

  // Rolling 24 hours, not "today": the 07:00 pass must not be handed a fresh allowance
  // by a midnight it never saw. Rows predating the mailbox_id column fall into the
  // default bucket, which is where they were sent from.
  const used = (await db()`
    select coalesce(m.mailbox_id, (select id from mailboxes where is_default order by id limit 1), 0)
             as mailbox_id,
           count(*)::int as sent
      from messages m
     where m.status = 'sent' and m.sent_at > now() - interval '24 hours'
     group by 1`) as { mailbox_id: number; sent: number }[]

  const sentPerMailbox = new Map(used.map((row) => [row.mailbox_id, row.sent]))
  return (mailboxId) =>
    Math.max(0, Math.min(perPass, cap - (sentPerMailbox.get(mailboxId) ?? 0)))
}

const ENROL_LIMIT = 500
const SCORE_LIMIT = 40
const DRAFT_LIMIT = 25
/** Stop starting new work with headroom under the 300s function limit. */
const PASS_BUDGET_MS = 170_000

/**
 * Bounded concurrency with a wall-clock deadline. Drafting a lead can take a minute
 * (web research plus a thinking model), so an unbounded pass over 25 leads blows past
 * the function timeout and the caller gets nothing back. Workers stop picking up new
 * items once the deadline passes; whatever is in flight finishes.
 */
async function mapLimit<T>(
  items: T[],
  limit: number,
  deadline: number,
  work: (item: T) => Promise<void>,
) {
  const queue = [...items]
  let failed = 0
  let reason = ''
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        if (Date.now() > deadline) return
        try {
          await work(item)
        } catch (error) {
          failed++
          // Keep the first reason: a count alone sends the user off to read logs.
          if (!reason) reason = describeApiError(error)
          console.error('pipeline item failed', error)
        }
      }
    }),
  )
  return { failed, reason }
}

export type CampaignPass = {
  enrolled: number
  scored: number
  drafted: number
  failed: number
  reason: string
  unscored: number
  due: number
}

/**
 * Everything a campaign does to itself, in order and bounded so one pass fits a
 * single invocation: pull leads from its source searches, score the new ones
 * against its own ICP, research only those that clear the floor (research is the
 * expensive step and only drafting uses it), then draft what is due.
 * Safe to run repeatedly — every stage skips work already done.
 */
export async function runCampaign(
  campaignId: number,
  report: (event: { phase: string; detail?: string }) => void = () => {},
  /** Shared when several campaigns run in one invocation, so they cannot overrun it together. */
  sharedDeadline?: number,
): Promise<CampaignPass> {
  const deadline = sharedDeadline ?? Date.now() + PASS_BUDGET_MS
  const empty = { enrolled: 0, scored: 0, drafted: 0, failed: 0, reason: '', unscored: 0, due: 0 }
  const [campaign] = (await db()`select * from campaigns where id = ${campaignId}`) as Campaign[]
  if (!campaign) return empty

  // 1. Enrol anything from the source searches that is not already in.
  report({ phase: 'Enrolling leads from the source searches' })
  let enrolled = 0
  if (campaign.source_search_ids.length) {
    // Suppressed leads are filtered here as well as at send. Cheaper: an enrollment that
    // never exists is never scored, researched or drafted, and each of those is a paid
    // model call spent on someone who asked us to stop.
    const inserted = (await db().query(
      `insert into enrollments (campaign_id, lead_id)
       select $1, l.id from leads l
        where l.search_id = any($2::int[])
          and l.status <> 'rejected'
          and not ${LEAD_IS_SUPPRESSED}
        order by l.id limit $3
       on conflict (campaign_id, lead_id) do nothing
       returning id`,
      [campaignId, campaign.source_search_ids, ENROL_LIMIT],
    )) as { id: number }[]
    enrolled = inserted.length
  }

  // 2. Score the unscored against this campaign's ICP.
  let scored = 0
  let failed = 0
  let reason = ''
  if (campaign.icp.trim()) {
    const unscored = (await db()`
      select e.id, e.lead_id from enrollments e
       where e.campaign_id = ${campaignId} and e.score is null
       order by e.id limit ${SCORE_LIMIT}`) as { id: number; lead_id: number }[]

    const pass = await mapLimit(unscored, 5, deadline, async (row) => {
      const [lead] = (await db()`select * from leads where id = ${row.lead_id}`) as Lead[]
      if (!lead) return
      const result = await qualifyLead(lead, campaign.icp)
      await db()`
        update enrollments
           set score = ${result.score}, verdict = ${result.verdict},
               reasons = ${result.reasons}, angle = ${result.angle}
         where id = ${row.id}`
      scored++
    })
    failed += pass.failed
    reason ||= pass.reason
  }

  // 3. Draft what is due, best-scoring first. Drafting researches as it goes.
  const due = (await db()`
    select id from enrollments
     where campaign_id = ${campaignId} and status = 'active'
       and next_send_at <= now() and score >= ${campaign.min_score}::int
     order by score desc, next_send_at limit ${DRAFT_LIMIT}`) as { id: number }[]

  report({ phase: `Writing ${due.length} email${due.length === 1 ? '' : 's'}` })
  let drafted = 0
  const draftPass = await mapLimit(due, 4, deadline, async (row) => {
    if (await draftForEnrollment(row.id, report)) drafted++
  })
  failed += draftPass.failed
  reason ||= draftPass.reason

  // What is still outstanding, so the caller can say whether another pass is needed.
  const [left] = (await db()`
    select
      (select count(*) from enrollments
        where campaign_id = ${campaignId} and score is null)::int as unscored,
      (select count(*) from enrollments e
        where e.campaign_id = ${campaignId} and e.status = 'active'
          and e.next_send_at <= now() and e.score >= ${campaign.min_score}::int
          and not exists (select 1 from messages m
                           where m.enrollment_id = e.id and m.step = e.step))::int as due
  `) as { unscored: number; due: number }[]

  return { enrolled, scored, drafted, failed, reason, unscored: left.unscored, due: left.due }
}

export type RewritePass = {
  rewritten: number
  failed: number
  reason: string
  /** Enrollments still without a draft — hand these back to carry on where this pass stopped. */
  pending: number[]
}

/**
 * Throw the chosen unsent drafts away and write them again from the campaign's current
 * wording. Concurrent and deadline-bounded like the drafting pass, so a whole selection
 * normally finishes in one request instead of ten at a time.
 *
 * Each draft is deleted immediately before it is rewritten rather than all up front: a
 * pass that runs out of time then leaves the ones it never reached intact, instead of
 * deleting fifty drafts and recreating twelve. Anything that fails mid-write comes back
 * in `pending`, so the caller can simply ask again.
 */
export async function rewriteDrafts(
  target: { messageIds?: number[]; enrollmentIds?: number[] },
  report: (event: { phase: string; detail?: string }) => void = () => {},
): Promise<RewritePass> {
  const deadline = Date.now() + PASS_BUDGET_MS

  let ids = target.enrollmentIds ?? []
  if (!ids.length && target.messageIds?.length) {
    const rows = (await db()`
      select distinct enrollment_id from messages
       where id = any(${target.messageIds}::int[]) and status <> 'sent'
       order by enrollment_id`) as { enrollment_id: number }[]
    ids = rows.map((row) => row.enrollment_id)
  }
  if (!ids.length) return { rewritten: 0, failed: 0, reason: '', pending: [] }

  let rewritten = 0
  const pass = await mapLimit(ids, 4, deadline, async (id) => {
    await db()`delete from messages where enrollment_id = ${id} and status <> 'sent'`
    if (await draftForEnrollment(id, report)) rewritten++
  })

  // Whatever still has no draft for its current step: never started, or failed mid-write.
  const left = (await db()`
    select e.id from enrollments e
     where e.id = any(${ids}::int[])
       and not exists (select 1 from messages m
                        where m.enrollment_id = e.id and m.step = e.step)
     order by e.id`) as { id: number }[]

  return { rewritten, failed: pass.failed, reason: pass.reason, pending: left.map((r) => r.id) }
}

/**
 * Send every approved message the daily allowance permits, best scores first.
 *
 * No model calls, so this is seconds of work rather than minutes. That matters: it used to
 * sit behind the drafting, and drafting is what runs out of time.
 */
/**
 * Seconds to wait between sends.
 *
 * The daily cap is per mailbox, but every mailbox here leaves through one provider on one
 * domain, so five mailboxes sending twenty each looks like a single sender firing a
 * hundred emails a minute. No individual mailbox went over its cap and the domain was
 * throttled anyway.
 *
 * The default comes from measurement, not a guess: two runs 42 minutes apart each
 * delivered exactly 25 before the provider answered 451, which puts its ceiling near 25
 * per five minutes, or one every twelve seconds. It is a setting because that number
 * belongs to whoever hosts the mailbox and will change if the mailbox moves.
 */
export const DEFAULT_SEND_SPACING_SECONDS = 10

export const sendSpacingMs = async () =>
  (Number(await getSetting('send_spacing_seconds', String(DEFAULT_SEND_SPACING_SECONDS))) ||
    DEFAULT_SEND_SPACING_SECONDS) * 1000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function sendApproved(deadline = Date.now() + 180_000) {
  // Highest-scoring leads go out first, so a partial run still hits the best ones — and
  // a pass that runs out of allowance has spent it on the best leads, not the first ones.
  const approved = (await db()`
    select m.id,
           coalesce(c.mailbox_id, (select id from mailboxes where is_default order by id limit 1), 0)
             as mailbox_id
      from messages m
      join enrollments e on e.id = m.enrollment_id
      join campaigns c on c.id = e.campaign_id
     where m.status = 'approved'
     order by e.score desc nulls last, m.created_at limit 100`) as {
    id: number
    mailbox_id: number
  }[]

  const allowance = await sendAllowance()
  const spacing = await sendSpacingMs()
  const left = new Map<number, number>()
  let sent = 0
  let held = 0

  let throttled = false
  for (const message of approved) {
    if (Date.now() > deadline) {
      held++
      continue
    }
    if (!left.has(message.mailbox_id)) left.set(message.mailbox_id, allowance(message.mailbox_id))
    if (left.get(message.mailbox_id)! <= 0) {
      held++
      continue
    }
    if (sent > 0) await sleep(spacing)
    try {
      const outcome = await sendMessage(message.id)
      if (outcome === 'sent') {
        left.set(message.mailbox_id, left.get(message.mailbox_id)! - 1)
        sent++
      } else {
        held++
      }
    } catch (error) {
      if (isTransientSendError(error)) {
        // The provider has told us to slow down. Every further attempt this round would
        // get the same answer, so stop; these stay approved and go out next time.
        console.warn('provider is throttling, stopping this pass', error)
        throttled = true
        break
      }
      console.error('send failed', message.id, error)
    }
  }

  return { sent, held, throttled }
}

/**
 * How long one automatic round may spend writing emails.
 *
 * The whole invocation gets 300s from the platform, and sending now happens before any of
 * this, so the only thing this bounds is drafting. Stopping at 240s leaves room for a
 * draft that is already in flight to finish.
 */
const TICK_BUDGET_MS = 240_000

export async function tick() {
  const deadline = Date.now() + TICK_BUDGET_MS
  await ingestSearches()

  // Replies before anything else: a lead who answered must not get the email already
  // sitting approved for them, and must not have another one drafted either.
  const { replied, auto, bounced } = await checkReplies().catch((error) => {
    console.error('reply check failed', error)
    return { replied: 0, auto: 0, bounced: 0 }
  })

  // Sending goes before drafting, and the order is the entire point. Drafting is model
  // work that takes minutes per campaign; with eight campaigns it used to consume the
  // whole invocation and the platform killed the function before a single approved email
  // left. Approved mail is the one thing here that must not be best-effort.
  const { sent, held, throttled } = await sendApproved(Math.min(deadline, Date.now() + 180_000))

  // Least recently written to first, so the last campaign in the list is not starved
  // every round once drafting runs out of time. Campaigns that have never drafted lead.
  const active = (await db()`
    select c.id from campaigns c
     where c.status = 'active'
     order by (select max(m.created_at) from messages m
                 join enrollments e on e.id = m.enrollment_id
                where e.campaign_id = c.id) asc nulls first, c.id`) as { id: number }[]

  let drafted = 0
  for (const campaign of active) {
    if (Date.now() > deadline) break
    try {
      const pass = await runCampaign(campaign.id, () => {}, deadline)
      drafted += pass.drafted
    } catch (error) {
      console.error('campaign pass failed', campaign.id, error)
    }
  }

  // Remember whether the mail server pushed back, so the outbox can tell "it is happening
  // now" from "it happened this morning and these are still in the queue". A message keeps
  // its error text until it sends, so counting errors alone cannot tell those apart.
  await setSetting('last_round_throttled', throttled ? 'yes' : 'no')

  return { replies: replied, autoReplies: auto, bounced, drafted, sent, held, throttled }
}
