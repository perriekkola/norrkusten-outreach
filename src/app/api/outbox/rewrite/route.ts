import { requireUser } from '@/lib/auth'
import { rewriteDrafts, type RewritePass } from '@/lib/engine'
import { progressStream } from '@/lib/stream'

export const maxDuration = 300

export async function POST(request: Request) {
  await requireUser()
  const { messageIds, enrollmentIds } = (await request.json()) as {
    messageIds?: number[]
    enrollmentIds?: number[]
  }
  return progressStream<RewritePass>((report) =>
    rewriteDrafts({ messageIds, enrollmentIds }, report),
  )
}
