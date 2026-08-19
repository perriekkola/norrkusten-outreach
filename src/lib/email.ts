import 'server-only'
import nodemailer from 'nodemailer'
import { db, type Mailbox } from './db'
import { textToHtml, withSignature } from './format'
import { decrypt } from './secrets'
import { appUrl, clickToken, trackToken } from './tracking'

/** One pooled transport per mailbox, reused across warm invocations. */
const transports = new Map<number, nodemailer.Transporter>()

function transportFor(mailbox: Mailbox) {
  const existing = transports.get(mailbox.id)
  if (existing) return existing

  const transport = nodemailer.createTransport({
    host: mailbox.smtp_host,
    port: mailbox.smtp_port,
    secure: mailbox.smtp_port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: mailbox.smtp_user, pass: decrypt(mailbox.smtp_pass) },
    pool: true,
    maxConnections: 2,
    rateDelta: 1000,
    rateLimit: 2,
  })
  transports.set(mailbox.id, transport)
  return transport
}

/** Drop a cached transport after its credentials change. */
export function forgetMailbox(id: number) {
  transports.get(id)?.close()
  transports.delete(id)
}

/**
 * Campaign mailbox, else the default one, else the environment. The env path keeps
 * an installation that predates mailboxes sending until someone adds one.
 */
export async function resolveMailbox(mailboxId?: number | null): Promise<Mailbox> {
  const rows = (await db()`
    select * from mailboxes
     where (${mailboxId ?? null}::int is null or id = ${mailboxId ?? null}::int)
     order by is_default desc, id limit 1`) as Mailbox[]
  if (rows[0]) return rows[0]

  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) {
    throw new Error('No mailbox configured — add one under Settings.')
  }
  return {
    id: 0,
    name: 'Environment',
    from_email: process.env.FROM_EMAIL || user,
    reply_to: process.env.REPLY_TO_EMAIL || null,
    smtp_host: host,
    smtp_port: Number(process.env.SMTP_PORT ?? 465),
    smtp_user: user,
    smtp_pass: '',
    signature: '',
    imap_host: process.env.IMAP_HOST || null,
    imap_port: Number(process.env.IMAP_PORT ?? 993),
    is_default: true,
    created_at: '',
  }
}

/** Env mailboxes carry no encrypted password; use the raw env value for those. */
function passwordFor(mailbox: Mailbox) {
  return mailbox.id === 0 ? (process.env.SMTP_PASS ?? '') : decrypt(mailbox.smtp_pass)
}

function open(mailbox: Mailbox) {
  if (mailbox.id === 0) {
    return nodemailer.createTransport({
      host: mailbox.smtp_host,
      port: mailbox.smtp_port,
      secure: mailbox.smtp_port === 465,
      auth: { user: mailbox.smtp_user, pass: passwordFor(mailbox) },
      pool: true,
      maxConnections: 2,
      rateDelta: 1000,
      rateLimit: 2,
    })
  }
  return transportFor(mailbox)
}

/** Open-tracking pixel. Omitted when the public URL is unknown (local dev). */
function pixelUrl(messageId?: number) {
  const base = appUrl()
  return messageId && base ? `${base}/api/t/${trackToken(messageId)}` : undefined
}

/** Routes links through the click endpoint. Only in the HTML part — the plain-text
 *  alternative keeps the real URL, so text-only clients get something readable. */
function linkRewriter(messageId?: number) {
  const base = appUrl()
  if (!messageId || !base) return undefined
  return (url: string) =>
    `${base}/api/c/${clickToken(messageId, url)}?u=${encodeURIComponent(url)}`
}

export async function sendEmail(args: {
  to: string
  subject: string
  body: string
  /** Enables open tracking and click rewriting for this message. */
  messageId?: number
  mailboxId?: number | null
}): Promise<{ id: string; mailbox: string }> {
  const mailbox = await resolveMailbox(args.mailboxId)
  const body = withSignature(args.body, mailbox.signature)

  const info = await open(mailbox).sendMail({
    from: mailbox.from_email,
    to: args.to,
    replyTo: mailbox.reply_to || undefined,
    subject: args.subject,
    text: body,
    html: textToHtml(body, pixelUrl(args.messageId), linkRewriter(args.messageId)),
  })

  if (info.rejected?.length) throw new Error(`Rejected by server: ${info.rejected.join(', ')}`)
  return { id: info.messageId, mailbox: mailbox.name }
}

/** Used by Settings to prove a mailbox works before a campaign goes out. */
export async function verifyMailbox(mailbox: Mailbox) {
  await open(mailbox).verify()
}
