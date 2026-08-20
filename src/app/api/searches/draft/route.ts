import { requireUser } from '@/lib/auth'
import { draftSearch, describeApiError, type SearchDraft } from '@/lib/ai'
import { progressStream } from '@/lib/stream'

export const maxDuration = 300

export async function POST(request: Request) {
  await requireUser()
  const { brief } = (await request.json()) as { brief?: string }
  if (!brief?.trim()) return Response.json({ error: 'Describe who you want to reach.' }, { status: 400 })

  const links = [...brief.matchAll(/https?:\/\/[^\s<>"']+/g)].map((match) => match[0])

  return progressStream<SearchDraft>(async (report) => {
    try {
      return await draftSearch({ brief, links, report })
    } catch (error) {
      throw new Error(describeApiError(error))
    }
  })
}
