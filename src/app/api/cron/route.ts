import { tick } from '@/lib/engine'

export const maxDuration = 300

// Vercel Cron hits this on the schedules in vercel.json (twice daily — Hobby caps each cron at once/day).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 500 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  try {
    return Response.json({ ok: true, ...(await tick()) })
  } catch (error) {
    console.error('cron failed', error)
    return Response.json({ ok: false, error: String(error) }, { status: 500 })
  }
}
