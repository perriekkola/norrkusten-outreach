import 'server-only'
import { ImapFlow } from 'imapflow'
import { db } from './db'

/**
 * Reads the mailbox over IMAP and matches incoming mail back to sent messages via the
 * In-Reply-To / References headers. Accurate — no guessing from subject lines.
 * A reply stops the sequence for that lead.
 */
export async function checkReplies(days = 14): Promise<number> {
  const host = process.env.IMAP_HOST
  const user = process.env.IMAP_USER || process.env.SMTP_USER
  const pass = process.env.IMAP_PASS || process.env.SMTP_PASS
  if (!host || !user || !pass) return 0

  const client = new ImapFlow({
    host,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: true,
    auth: { user, pass },
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
