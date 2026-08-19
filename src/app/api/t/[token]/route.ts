import { db } from '@/lib/db'
import { readTrackToken } from '@/lib/tracking'

// 1x1 transparent GIF.
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

export async function GET(_request: Request, context: RouteContext<'/api/t/[token]'>) {
  const { token } = await context.params
  const id = readTrackToken(token)

  if (id) {
    await db()`
      update messages
         set opened_at = coalesce(opened_at, now()), open_count = open_count + 1
       where id = ${id} and status = 'sent'`.catch(() => {})
  }

  return new Response(new Uint8Array(PIXEL), {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
}
