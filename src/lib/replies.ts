import 'server-only'
import { ImapFlow } from 'imapflow'
import { db, type Mailbox } from './db'
import { isAutoReply, isBounce, referencedIds, replyText } from './format'
import { classifyReply } from './ai'
import { suppress } from './suppression'
import { decrypt } from './secrets'

/**
 * Reads the mailbox over IMAP and matches incoming mail back to sent messages via the
 * In-Reply-To / References headers. Accurate — no guessing from subject lines.
 * A reply stops the sequence for that lead.
 */
export async function checkReplies(
  days = 14,
): Promise<{ replied: number; auto: number; bounced: number; optedOut: number }> {
  const mailboxes = (await db()`
    select * from mailboxes where imap_host is not null and imap_host <> ''`) as Mailbox[]

  // Fall back to the environment for an installation that predates the mailboxes table.
  if (!mailboxes.length && process.env.IMAP_HOST) {
    const user = process.env.IMAP_USER || process.env.SMTP_USER
    const pass = process.env.IMAP_PASS || process.env.SMTP_PASS
    if (!user || !pass) return { replied: 0, auto: 0, bounced: 0, optedOut: 0 }
    const only = await pollMailbox(
      {
        host: process.env.IMAP_HOST,
        port: Number(process.env.IMAP_PORT ?? 993),
        user,
        pass,
      },
      days,
    )
    return {
      replied: only.matched,
      auto: only.auto,
      bounced: only.bounced,
      optedOut: only.optedOut,
    }
  }

  let replied = 0
  let auto = 0
  let bounced = 0
  let optedOut = 0
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
      optedOut += one.optedOut
    } catch (error) {
      // One unreachable mailbox must not stop the others from being checked.
      console.error('reply check failed for mailbox', mailbox.id, error)
    }
  }
  return { replied, auto, bounced, optedOut }
}

async function pollMailbox(
  account: { host: string; port: number; user: string; pass: string },
  days: number,
): Promise<{ matched: number; auto: number; bounced: number; optedOut: number }> {
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
  let optedOut = 0
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    for await (const mail of client.fetch(
      { since },
      {
        envelope: true,
        // The body too, so a reply can be read and acted on rather than only counted.
        bodyParts: ['text'],
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
      // `reply_text is null` rather than `replied_at is null`, so replies matched before
      // any of this existed get their text and their reading on the next poll instead of
      // staying blank for ever.
      const rows = (await db()`
        select m.id, m.lead_id, m.enrollment_id, m.subject, m.replied_at, l.email
          from messages m join leads l on l.id = m.lead_id
         where m.provider_id = any(${normalised}::text[]) and m.status = 'sent'
           and (m.replied_at is null or m.reply_text is null)`) as {
        id: number
        lead_id: number
        enrollment_id: number
        subject: string
        replied_at: string | null
        email: string
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

        const text = replyText(
          (mail.bodyParts?.get('text') ?? mail.bodyParts?.get('TEXT'))?.toString('utf8') ?? '',
        )

        await db()`
          update messages set replied_at = coalesce(replied_at, now()), reply_text = ${text}
           where id = ${row.id}`
        await db()`update leads set status = 'replied' where id = ${row.lead_id}`
        await db()`
          update enrollments set status = 'replied'
           where id = ${row.enrollment_id} and status = 'active'`
        await db()`
          update messages set status = 'skipped'
           where enrollment_id = ${row.enrollment_id} and status in ('draft', 'approved')`

        // Read it and act. Only an explicit opt-out does anything on its own; the rest is
        // a label so the outbox can be triaged without opening a mail client.
        if (text) {
          try {
            const read = await classifyReply(text, row.subject)
            await db()`
              update messages set reply_intent = ${read.intent}, reply_summary = ${read.summary}
               where id = ${row.id}`
            if (read.intent === 'opt_out') {
              // Doing this by hand means it waits until somebody reads their inbox, and
              // this is the one kind of reply that carries a legal obligation.
              await suppress(row.email, `Asked to be removed: ${read.summary}`, 'reply')
              optedOut++
            }
          } catch (error) {
            // A reply that cannot be read is still a reply. Never lose the match over it.
            console.error('could not read reply', row.id, error)
          }
        }

        // Already counted on an earlier poll; this pass only filled in the text.
        if (!row.replied_at) matched++
      }
    }
  } finally {
    lock.release()
    await client.logout().catch(() => {})
  }
  return { matched, auto, bounced, optedOut }
}
