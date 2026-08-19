import { db } from '@/lib/db'
import { readClickToken } from '@/lib/tracking'

export async function GET(request: Request, context: RouteContext<'/api/c/[token]'>) {
  const { token } = await context.params
  const target = new URL(request.url).searchParams.get('u') ?? ''

  // The signature covers the destination, so `u` cannot be swapped for somewhere else.
  const id = readClickToken(token, target)
  if (!id) return new Response('Bad link', { status: 400 })

  // Belt and braces: never redirect to a scheme that could run code.
  let destination: URL
  try {
    destination = new URL(target)
  } catch {
    return new Response('Bad link', { status: 400 })
  }
  if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
    return new Response('Bad link', { status: 400 })
  }

  await db()`
    update messages
       set clicked_at = coalesce(clicked_at, now()), click_count = click_count + 1
     where id = ${id} and status = 'sent'`.catch(() => {})

  return Response.redirect(destination.toString(), 302)
}
