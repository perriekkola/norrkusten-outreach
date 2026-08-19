import 'server-only'
import { getDatasetItems, getRun } from './apify'
import { draftEmail } from './ai'
import { db, jsonb, type Campaign, type Lead, type Message } from './db'
import { sendEmail } from './email'
import { checkReplies } from './replies'

const str = (row: Record<string, unknown>, key: string) => {
  const value = row[key]
  if (value === null || value === undefined || value === '') return null
  return String(value).slice(0, 2000)
}

/** Apify rows -> leads. Unknown fields survive in `raw`. */
async function importDataset(searchId: number, rows: Record<string, unknown>[]) {
  let imported = 0
  for (const row of rows) {
    const email = str(row, 'email')
    if (!email || !email.includes('@')) continue
    const result = (await db()`
      insert into leads (
        search_id, email, first_name, last_name, full_name, job_title, seniority, linkedin,
        phone, city, country, company_name, company_domain, company_website, company_linkedin,
        company_size, industry, company_description, raw
      ) values (
        ${searchId}, ${email.toLowerCase()}, ${str(row, 'first_name')}, ${str(row, 'last_name')},
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
export async function draftForEnrollment(enrollmentId: number): Promise<number | null> {
  const rows = (await db()`
    select e.step, e.lead_id, c.id as campaign_id, c.name, c.offer, c.language, c.from_name,
           c.auto_send, c.steps, c.status, c.created_at
      from enrollments e join campaigns c on c.id = e.campaign_id
     where e.id = ${enrollmentId}`) as (Omit<Campaign, 'id'> & {
    step: number
    lead_id: number
    campaign_id: number
  })[]
  const row = rows[0]
  if (!row) return null

  const campaign: Campaign = { ...row, id: row.campaign_id }
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

  const previous = (await db()`
    select subject, body from messages
     where enrollment_id = ${enrollmentId} and status = 'sent' order by step`) as {
    subject: string
    body: string
  }[]

  const senderName = campaign.from_name || 'Norrkusten'
  const draft = await draftEmail({ lead, campaign, step: row.step, senderName, previous })

  const [message] = (await db()`
    insert into messages (enrollment_id, lead_id, step, subject, body, status)
    values (${enrollmentId}, ${lead.id}, ${row.step}, ${draft.subject}, ${draft.body},
            ${campaign.auto_send ? 'approved' : 'draft'})
    on conflict (enrollment_id, step) do update
      set subject = excluded.subject, body = excluded.body, status = excluded.status
    returning id`) as { id: number }[]
  return message.id
}

/** Send one approved message and move its enrollment to the next step. */
export async function sendMessage(messageId: number) {
  const [message] = (await db()`select * from messages where id = ${messageId}`) as Message[]
  if (!message || message.status === 'sent') return

  const [lead] = (await db()`select email from leads where id = ${message.lead_id}`) as {
    email: string
  }[]
  if (!lead) throw new Error('Lead is gone')

  try {
    const sent = await sendEmail({
      to: lead.email,
      subject: message.subject,
      body: message.body,
      messageId: message.id,
    })
    await db()`
      update messages set status = 'sent', provider_id = ${sent.id}, sent_at = now(), error = null
       where id = ${message.id}`
  } catch (error) {
    await db()`update messages set status = 'failed', error = ${String(error)} where id = ${message.id}`
    throw error
  }

  await db()`update leads set status = 'contacted' where id = ${message.lead_id} and status in ('new','qualified')`

  // Schedule the next step, or finish the enrollment.
  const [enrollment] = (await db()`
    select e.id, e.step, c.steps
      from enrollments e join campaigns c on c.id = e.campaign_id
     where e.id = ${message.enrollment_id}`) as {
    id: number
    step: number
    steps: { delay_days: number }[]
  }[]
  if (!enrollment) return

  const next = enrollment.step + 1
  if (next >= enrollment.steps.length) {
    await db()`update enrollments set status = 'done', step = ${next} where id = ${enrollment.id}`
    return
  }
  const days = Number(enrollment.steps[next]?.delay_days ?? 3)
  await db()`
    update enrollments
       set step = ${next}, next_send_at = now() + make_interval(days => ${days}::int)
     where id = ${enrollment.id}`
}

/** One pass: draft what is due, send what is approved. */
export async function runSequences() {
  const due = (await db()`
    select e.id from enrollments e
      join campaigns c on c.id = e.campaign_id
     where e.status = 'active' and c.status = 'active' and e.next_send_at <= now()
     order by e.next_send_at limit 100`) as { id: number }[]

  const drafted: number[] = []
  for (const enrollment of due) {
    try {
      const id = await draftForEnrollment(enrollment.id)
      if (id) drafted.push(id)
    } catch (error) {
      console.error('draft failed', enrollment.id, error)
    }
  }

  const approved = (await db()`
    select id from messages where status = 'approved' order by created_at limit 100`) as {
    id: number
  }[]

  let sent = 0
  for (const message of approved) {
    try {
      await sendMessage(message.id)
      sent++
    } catch (error) {
      console.error('send failed', message.id, error)
    }
  }

  return { drafted: drafted.length, sent }
}

export async function tick() {
  await ingestSearches()
  // Replies first: a lead who answered must not get the next step.
  const replies = await checkReplies().catch((error) => {
    console.error('reply check failed', error)
    return 0
  })
  return { replies, ...(await runSequences()) }
}
