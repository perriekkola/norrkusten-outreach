import 'server-only'
import { ImapFlow } from 'imapflow'
import { db, type Mailbox } from './db'
import { isAutoReply, isBounce, referencedIds, replyText, textPartPath } from './format'
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

/**
 * One body part, decoded.
 *
 * download() is what does the work: it reads that part's own Content-Transfer-Encoding and
 * Content-Type, undoes quoted-printable or base64, and converts the charset to UTF-8. The
 * cap keeps a reply with a megabyte of inline signature image from being read into memory
 * whole — replyText keeps 4 kB of it either way.
 */
async function bodyText(client: ImapFlow, uid: number, part?: string): Promise<string> {
  try {
    const { content } = await client.download(String(uid), part ?? '1', {
      uid: true,
      maxBytes: 256 * 1024,
    })
    if (!content) return ''
    const chunks: Buffer[] = []
    for await (const chunk of content) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  } catch (error) {
    // A body that will not download is still a reply. Never lose the match over it.
    console.error('could not download reply body', uid, error)
    return ''
  }
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
    // fetchAll rather than the streaming iterator, because the body of a matched reply is
    // downloaded below and a second command issued while a fetch is still streaming waits
    // on a connection that is waiting on this loop.
    const mails = await client.fetchAll(
      { since },
      {
        uid: true,
        envelope: true,
        // Names the part holding the text, so the body can be fetched decoded rather than
        // in the sender's transfer encoding. The body itself is pulled per matched reply.
        bodyStructure: true,
        // Everything isAutoReply looks at, fetched in the same pass.
        headers: [
          'references',
          'auto-submitted',
          'precedence',
          'x-autoreply',
          'x-autorespond',
          'content-type',
          'return-path',
          'x-failed-recipients',
        ],
      },
    )
    for (const mail of mails) {
      const raw = mail.headers?.toString('utf8') ?? ''
      const ids = [mail.envelope?.inReplyTo, ...referencedIds(raw)].filter(
        (value): value is string => Boolean(value),
      )
      if (!ids.length) continue

      const normalised = ids.map((value) => (value.startsWith('<') ? value : `<${value}>`))
      // Matched on missing work rather than on `replied_at is null`, for two reasons.
      // Replies caught before any of this existed get their text on the next poll instead
      // of staying blank for ever. And a reading that failed on a bad API call is retried,
      // since the text was already saved by then and the row would otherwise never be
      // looked at again — which for an opt_out is the one outcome worth spending twice on.
      // Nothing successful is ever redone: text present and intent set excludes the row.
      const rows = (await db()`
        select m.id, m.lead_id, m.enrollment_id, m.subject, m.replied_at, l.email
          from messages m join leads l on l.id = m.lead_id
         where m.provider_id = any(${normalised}::text[]) and m.status = 'sent'
           and coalesce(m.reply_intent, '') <> 'not_a_reply'
           and (m.replied_at is null or m.reply_text is null
                or (m.reply_text <> '' and m.reply_intent is null))`) as {
        id: number
        lead_id: number
        enrollment_id: number
        subject: string
        replied_at: string | null
        email: string
      }[]

      // Everything below judges what kind of message this is, and that only makes sense
      // once it is known to be a reply to something we sent. Judging first counted every
      // newsletter in the inbox carrying Precedence: bulk as an out-of-office.
      if (!rows.length) continue

      const subject = mail.envelope?.subject ?? ''
      const sender = mail.envelope?.from?.map((a) => a.address ?? '').join(' ') ?? ''

      // Bounce first, and the order is not a detail. A delivery report is auto-submitted
      // by definition, so it carries Auto-Submitted: auto-replied like any out-of-office
      // does. Asking "is this automatic?" first swallows every bounce as an out-of-office
      // and the address is never marked dead, which is exactly what happened here: twelve
      // undeliverable reports sat recorded as replies.
      const bounce = isBounce(raw, subject, sender)

      // An out-of-office is not an answer, and unlike a bounce it is not a dead end
      // either. Leaving the sequence running is the point: they are away, not
      // uninterested, and the next step is days out anyway.
      if (!bounce && isAutoReply(raw, subject)) {
        auto++
        continue
      }

      // Once per mail rather than once per matched row, and never for a bounce — that one
      // is judged from its headers and its body is a delivery report nobody reads.
      const text = bounce
        ? ''
        : replyText(await bodyText(client, mail.uid, textPartPath(mail.bodyStructure)))

      for (const row of rows) {
        if (bounce) {
          // Not marked replied: it was never delivered, so counting it as engagement
          // would overstate the reply rate with the one thing that is the opposite of it.
          // replied_at is cleared, not just left alone. Before bounces were told apart
          // these were recorded as replies, and a bounce counted as engagement is the
          // most misleading number this app can show.
          await db()`
            update messages
               set status = 'failed', replied_at = null, reply_intent = null,
                   error = ${`Bounced: ${subject}`.slice(0, 500)}
             where id = ${row.id}`
          await db()`update leads set status = 'bounced' where id = ${row.lead_id}`
          // Also from 'replied', not just from 'active'. Before bounces were told apart
          // these enrollments were marked replied, and only the message was corrected
          // above, leaving twelve dead addresses recorded as people who answered. Guarded
          // so a lead who genuinely replied and later bounced keeps the reply.
          await db()`
            update enrollments set status = 'bounced'
             where id = ${row.enrollment_id} and status in ('active', 'replied')
               and not exists (select 1 from messages m
                                where m.enrollment_id = ${row.enrollment_id}
                                  and m.replied_at is not null)`
          await db()`
            update messages set status = 'skipped'
             where enrollment_id = ${row.enrollment_id} and status in ('draft', 'approved')`
          bounced++
          continue
        }

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
