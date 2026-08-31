import { after } from 'next/server'
import { getSetting, setSetting } from '@/lib/db'
import { tick } from '@/lib/engine'

export const maxDuration = 300

/**
 * Starts a round. Called by whatever runs the schedule.
 *
 * It answers immediately and does the work afterwards, which is what lets any free
 * scheduler drive it. A round takes minutes: it paces sending on purpose and writes emails
 * with a model. Hosted pingers give up long before that, cron-job.org at thirty seconds,
 * and would mark a perfectly good round failed and retry it on top of itself.
 *
 * `after` keeps the function alive once the response has gone, up to maxDuration, so the
 * round finishes while the caller sees a fast 200. Nothing here is specific to one host,
 * which is the point: the pace can be changed without moving the app.
 *
 * The response carries the previous round's result, because this one has not happened
 * yet. That way a scheduler's log is still worth reading.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const previous = await getSetting('last_round', '')

  after(async () => {
    const at = new Date().toISOString()
    try {
      const result = await tick()
      await setSetting('last_round', JSON.stringify({ at, ...result }))
    } catch (error) {
      // The round is over either way. What matters is that the reason outlives it, since
      // nobody is reading this response by the time it fails.
      console.error('cron failed', error)
      await setSetting('last_round', JSON.stringify({ at, error: String(error) }))
    }
  })

  return Response.json({
    ok: true,
    started: true,
    previous: previous ? JSON.parse(previous) : null,
  })
}
