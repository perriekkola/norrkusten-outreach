import { db } from '@/lib/db'
import { suppress } from '@/lib/suppression'
import { readUnsubToken } from '@/lib/tracking'

/**
 * Opt-out. GET asks; POST acts.
 *
 * Not a one-click GET on purpose: corporate link scanners follow every URL in an
 * incoming email, and a GET that unsubscribes would silently drop good leads without
 * anyone having read the message. One button after opening is still "clear and easy"
 * under ePrivacy art. 13(4), and RFC 8058's List-Unsubscribe-Post hits the POST
 * directly, so Gmail's own Unsubscribe button stays genuinely one click.
 */

const page = (title: string, body: string, action?: string) =>
  new Response(
    `<!doctype html><html lang="sv"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex" /><title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;
 font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111">
<main style="max-width:32rem;padding:2rem;text-align:center">
<h1 style="font-size:1.25rem;margin:0 0 .75rem">${title}</h1>
<p style="margin:0;color:#555;line-height:1.6">${body}</p>
${
  action
    ? `<form method="post" style="margin-top:1.5rem"><button type="submit"
 style="font:inherit;padding:.6rem 1.4rem;border:0;border-radius:.5rem;background:#111;
 color:#fff;cursor:pointer">${action}</button></form>`
    : ''
}
</main></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )

async function addressFor(token: string): Promise<string | null> {
  const id = readUnsubToken(token)
  if (!id) return null
  const rows = (await db()`
    select l.email from messages m join leads l on l.id = m.lead_id where m.id = ${id}`) as {
    email: string
  }[]
  return rows[0]?.email ?? null
}

/** Mask the address: the link may be opened by whoever the mail was forwarded to. */
const mask = (email: string) => email.replace(/^(.).*?(@)/, '$1•••$2')

export async function GET(_request: Request, context: RouteContext<'/api/u/[token]'>) {
  const { token } = await context.params
  const email = await addressFor(token)
  if (!email) return page('Länken gäller inte', 'Hör av dig till avsändaren så tar vi bort dig manuellt.')

  return page(
    'Avregistrera',
    `Bekräfta att <strong>${mask(email)}</strong> inte ska få fler mejl från oss. Vi tar bort adressen ur alla utskick direkt.`,
    'Avregistrera mig',
  )
}

export async function POST(_request: Request, context: RouteContext<'/api/u/[token]'>) {
  const { token } = await context.params
  const email = await addressFor(token)
  if (!email) return page('Länken gäller inte', 'Hör av dig till avsändaren så tar vi bort dig manuellt.')

  await suppress(email, 'Unsubscribed from an email', 'unsubscribe')
  return page('Klart', 'Du är borttagen och får inga fler mejl från oss.')
}
