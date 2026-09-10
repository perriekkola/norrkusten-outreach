import { requireUser } from '@/lib/auth'
import { draftCampaign, describeApiError, type CampaignDraft } from '@/lib/ai'
import { getSetting, searchOptions, type WritingMode } from '@/lib/db'
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
    const searches = await searchOptions()

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
