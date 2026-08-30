import { requireUser } from '@/lib/auth'
import { draftCampaign, describeApiError, type CampaignDraft } from '@/lib/ai'
import { db, getSetting, type WritingMode } from '@/lib/db'
import { progressStream } from '@/lib/stream'

export const maxDuration = 300

export async function POST(request: Request) {
  await requireUser()
  const { brief, writingMode } = (await request.json()) as {
    brief?: string
    writingMode?: WritingMode
  }
  if (!brief?.trim()) return Response.json({ error: 'Describe what you want to sell.' }, { status: 400 })

  const links = [...brief.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => match[0])

  return progressStream<CampaignDraft>(async (report) => {
    const searches = (await db()`
      select s.id, s.label, count(l.id)::int as leads
        from searches s left join leads l on l.search_id = s.id
       group by s.id, s.label having count(l.id) > 0
       order by s.created_at desc`) as { id: number; label: string; leads: number }[]

    try {
      return await draftCampaign({
        brief,
        links,
        senderName: (await getSetting('sender_name')) || 'Norrkusten',
        writingMode,
        searches,
        report,
      })
    } catch (error) {
      throw new Error(describeApiError(error))
    }
  })
}
