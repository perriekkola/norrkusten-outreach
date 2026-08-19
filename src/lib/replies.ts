import 'server-only'
import { ImapFlow } from 'imapflow'
import { db, type Mailbox } from './db'
import { decrypt } from './secrets'

/**
 * Reads the mailbox over IMAP and matches incoming mail back to sent messages via the
 * In-Reply-To / References headers. Accurate — no guessing from subject lines.
 * A reply stops the sequence for that lead.
 */
export async function checkReplies(days = 14): Promise<number> {
  const mailboxes = (await db()`
    select * from mailboxes where imap_host is not null and imap_host <> ''`) as Mailbox[]

  // Fall back to the environment for an installation that predates the mailboxes table.
  if (!mailboxes.length && process.env.IMAP_HOST) {
    const user = process.env.IMAP_USER || process.env.SMTP_USER
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS
    if (!user || !pass) return 0
    return pollMailbox(
      {
        host: process.env.IMAP_HOST,
        port: Number(process.env.IMAP_PORT ?? 993),
        user,
        pass,
      },
      days,
    )
  }

  let total = 0
  for (const mailbox of mailboxes) {
    try {
      total += await pollMailbox(
        {
          host: mailbox.imap_host!,
          port: mailbox.imap_port,
          user: mailbox.smtp_user,
          pass: decrypt(mailbox.smtp_pass),
        },
        days,
      )
    } catch (error) {
      // One unreachable mailbox must not stop the others from being checked.
      console.error('reply check failed for mailbox', mailbox.id, error)
    }
  }
  return total
}

async function pollMailbox(
  account: { host: string; port: number; user: string; pass: string },
  days: number,
): Promise<number> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.user, pass: account.pass },
    logger: false,
  })

  let matched = 0
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    for await (const mail of client.fetch({ since }, { envelope: true, headers: ['references'] })) {
      const references = mail.headers?.toString('utf8') ?? ''
      const ids = [
        mail.envelope?.inReplyTo,
        ...(references.match(/<[^>\s]+>/g) ?? []),
      ].filter((value): value is string => Boolean(value))
      if (!ids.length) continue

      const normalised = ids.map((value) => (value.startsWith('<') ? value : `<${value}>`))
      const rows = (await db()`
        select id, lead_id, enrollment_id from messages
         where provider_id = any(${normalised}::text[]) and status = 'sent' and replied_at is null`) as {
        id: number
        lead_id: number
        enrollment_id: number
      }[]

      for (const row of rows) {
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
  return matched
}
