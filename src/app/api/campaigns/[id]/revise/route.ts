import { requireUser } from '@/lib/auth'
import { reviseCampaign, describeApiError, type CampaignDraft } from '@/lib/ai'
import { db, getSetting, type Campaign } from '@/lib/db'
import { progressStream } from '@/lib/stream'

export const maxDuration = 300

export async function POST(request: Request, context: RouteContext<'/api/campaigns/[id]/revise'>) {
  await requireUser()
  const { id } = await context.params
  const { instruction } = (await request.json()) as { instruction?: string }
  if (!instruction?.trim()) {
    return Response.json({ error: 'Say what you want changed.' }, { status: 400 })
  }

  const [campaign] = (await db()`
    select * from campaigns where id = ${Number(id)}`) as Campaign[]
  if (!campaign) return Response.json({ error: 'That campaign is gone.' }, { status: 404 })

  // Same rule as drafting: a URL in the instruction is a page to go and read.
  const links = [...instruction.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => match[0])

  return progressStream<CampaignDraft>(async (report) => {
    const searches = (await db()`
      select s.id, s.label, count(l.id)::int as leads
        from searches s left join leads l on l.search_id = s.id
       group by s.id, s.label having count(l.id) > 0
       order by s.created_at desc`) as { id: number; label: string; leads: number }[]

    try {
      return await reviseCampaign({
        campaign,
        instruction,
        links,
        senderName: campaign.from_name || (await getSetting('sender_name')) || 'Norrkusten',
        searches,
        report,
      })
    } catch (error) {
      throw new Error(describeApiError(error))
    }
  })
}
