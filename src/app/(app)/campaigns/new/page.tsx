import { PageHeader } from '@/components/page-header'
import { db } from '@/lib/db'
import { CampaignForm } from '../campaign-form'

export default async function NewCampaignPage() {
  const searches = (await db()`
    select s.id, s.label, count(l.id)::int as leads
      from searches s left join leads l on l.search_id = s.id
     group by s.id, s.label having count(l.id) > 0
     order by s.created_at desc`) as { id: number; label: string; leads: number }[]

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Each step is a goal, not a template — Claude writes the actual email per lead."
      />
      <CampaignForm searches={searches} />
    </>
  )
}
