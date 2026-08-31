import { after } from 'next/server'
import { db } from '@/lib/db'
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

  // tick() records every round in `runs`, so the last one is read from there rather than
  // kept in a second place that could disagree with it.
  const [last] = (await db()`
    select started_at, ok, result, error from runs
     where finished_at is not null order by started_at desc limit 1`) as {
    started_at: string
    ok: boolean
    result: unknown
    error: string | null
  }[]

  after(async () => {
    try {
      await tick()
    } catch (error) {
      // Already recorded against the run row by tick(). Logged so it reaches the platform
      // as well, since nobody is reading this response by the time a round fails.
      console.error('cron failed', error)
    }
  })

  return Response.json({
    ok: true,
    started: true,
    previous: last ? { at: last.started_at, ok: last.ok, ...(last.result ?? {}), error: last.error } : null,
  })
}
