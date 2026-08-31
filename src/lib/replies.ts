import 'server-only'
import { ImapFlow } from 'imapflow'
import { db, type Mailbox } from './db'
import { isAutoReply, isBounce, referencedIds } from './format'
import { decrypt } from './secrets'

/**
 * Reads the mailbox over IMAP and matches incoming mail back to sent messages via the
 * In-Reply-To / References headers. Accurate — no guessing from subject lines.
 * A reply stops the sequence for that lead.
 */
export async function checkReplies(
  days = 14,
): Promise<{ replied: number; auto: number; bounced: number }> {
  const mailboxes = (await db()`
    select * from mailboxes where imap_host is not null and imap_host <> ''`) as Mailbox[]

  // Fall back to the environment for an installation that predates the mailboxes table.
  if (!mailboxes.length && process.env.IMAP_HOST) {
    const user = process.env.IMAP_USER || process.env.SMTP_USER
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS
    if (!user || !pass) return { replied: 0, auto: 0, bounced: 0 }
    const only = await pollMailbox(
      {
        host: process.env.IMAP_HOST,
        port: Number(process.env.IMAP_PORT ?? 993),
        user,
        pass,
      },
      days,
    )
    return { replied: only.matched, auto: only.auto, bounced: only.bounced }
  }

  let replied = 0
  let auto = 0
  let bounced = 0
  for (const mailbox of mailboxes) {
    try {
      const one = await pollMailbox(
        {
          host: mailbox.imap_host!,
          port: mailbox.imap_port,
          user: mailbox.smtp_user,
          pass: decrypt(mailbox.smtp_pass),
        },
        days,
      )
      replied += one.matched
      auto += one.auto
      bounced += one.bounced
    } catch (error) {
      // One unreachable mailbox must not stop the others from being checked.
      console.error('reply check failed for mailbox', mailbox.id, error)
    }
  }
  return { replied, auto, bounced }
}

async function pollMailbox(
  account: { host: string; port: number; user: string; pass: string },
  days: number,
): Promise<{ matched: number; auto: number; bounced: number }> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  })

  let matched = 0
  let auto = 0
  let bounced = 0
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    for await (const mail of client.fetch(
      { since },
      {
        envelope: true,
        // Everything isAutoReply looks at, fetched in the same pass.
        headers: [
          'references',
          'auto-submitted',
          'precedence',
          'x-autoreply',
          'x-autorespond',
          'x-auto-response-suppress',
          'content-type',
          'return-path',
          'x-failed-recipients',
        ],
      },
    )) {
      const raw = mail.headers?.toString('utf8') ?? ''
      const ids = [mail.envelope?.inReplyTo, ...referencedIds(raw)].filter(
        (value): value is string => Boolean(value),
      )
      if (!ids.length) continue

      const subject = mail.envelope?.subject ?? ''
      const sender = mail.envelope?.from?.map((a) => a.address ?? '').join(' ') ?? ''

      // An out-of-office is not an answer. Leaving the sequence running is the whole
      // point: they are away, not uninterested, and the next step is due in days anyway.
      if (isAutoReply(raw, subject)) {
        auto++
        continue
      }

      // A bounce is the opposite: the address did not receive it and never will, so the
      // sequence has to stop even though nobody engaged.
      const bounce = isBounce(raw, subject, sender)

      const normalised = ids.map((value) => (value.startsWith('<') ? value : `<${value}>`))
      const rows = (await db()`
        select id, lead_id, enrollment_id from messages
         where provider_id = any(${normalised}::text[]) and status = 'sent' and replied_at is null`) as {
        id: number
        lead_id: number
        enrollment_id: number
      }[]

      for (const row of rows) {
        if (bounce) {
          // Not marked replied: it was never delivered, so counting it as engagement
          // would overstate the reply rate with the one thing that is the opposite of it.
          await db()`
            update messages set status = 'failed', error = ${`Bounced: ${subject}`.slice(0, 500)}
             where id = ${row.id}`
          await db()`update leads set status = 'bounced' where id = ${row.lead_id}`
          await db()`
            update enrollments set status = 'bounced'
             where id = ${row.enrollment_id} and status = 'active'`
          await db()`
            update messages set status = 'skipped'
             where enrollment_id = ${row.enrollment_id} and status in ('draft', 'approved')`
          bounced++
          continue
        }

        await db()`update messages set replied_at = now() where id = ${row.id}`
        await db()`update leads set status = 'replied' where id = ${row.lead_id}`
        await db()`
          update enrollments set status = 'replied'
           where id = ${row.enrollment_id} and status = 'active'`
        await db()`
          update messages set status = 'skipped'
           where enrollment_id = ${row.enrollment_id} and status in ('draft', 'approved')`
        matched++
      }
    }
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
  return { matched, auto, bounced }
}
