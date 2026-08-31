import { tick } from '@/lib/engine'

export const maxDuration = 300

// Called by whatever runs the schedule: vercel.json, the GitHub Action in
// .github/workflows/rounds.yml, or a crontab. It is a plain authenticated GET on purpose,
// so the pace can be changed without moving the app. Whatever calls it, keep "Rounds a
// day" in Settings matching how often, or early rounds spend the whole daily allowance.
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
