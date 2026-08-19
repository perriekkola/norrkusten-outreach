import { requireUser } from '@/lib/auth'
import { runCampaign, type CampaignPass } from '@/lib/engine'
import { progressStream } from '@/lib/stream'

export const maxDuration = 300

export async function POST(_request: Request, context: RouteContext<'/api/campaigns/[id]/run'>) {
  await requireUser()
  const { id } = await context.params
  return progressStream<CampaignPass>((report) => runCampaign(Number(id), report))
}
