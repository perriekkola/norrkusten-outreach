import 'server-only'
import nodemailer from 'nodemailer'
import { textToHtml } from './format'
import { appUrl, trackToken } from './tracking'

let transport: nodemailer.Transporter | null = null

/** SMTP (one.com: send.one.com, port 465 SSL). Reused across warm invocations. */
function smtp() {
  if (transport) return transport

  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set')

  const port = Number(process.env.SMTP_PORT ?? 465)
  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user, pass },
    pool: true,
    maxConnections: 2,
    rateDelta: 1000,
    rateLimit: 2,
  })
  return transport
}

export function fromAddress() {
  return process.env.FROM_EMAIL || process.env.SMTP_USER || ''
}

/** Open-tracking pixel. Omitted when the public URL is unknown (local dev). */
function pixelUrl(messageId?: number) {
  const base = appUrl()
  return messageId && base ? `${base}/api/t/${trackToken(messageId)}` : undefined
}

export async function sendEmail(args: {
  to: string
  subject: string
  body: string
  /** Enables the open-tracking pixel and threads replies back to this message. */
  messageId?: number
  headers?: Record<string, string>
}): Promise<{ id: string }> {
  const from = fromAddress()
  if (!from) throw new Error('FROM_EMAIL is not set')

  const info = await smtp().sendMail({
    from,
    to: args.to,
    replyTo: process.env.REPLY_TO_EMAIL || undefined,
    subject: args.subject,
    text: args.body,
    html: textToHtml(args.body, pixelUrl(args.messageId)),
    headers: args.headers,
  })

  if (info.rejected?.length) throw new Error(`Rejected by server: ${info.rejected.join(', ')}`)
  return { id: info.messageId }
}

/** Used by /settings to prove the mailbox works before a campaign goes out. */
export async function verifySmtp() {
  await smtp().verify()
}
