import { PageHeader } from '@/components/page-header'
import { db } from '@/lib/db'
import { NewCampaign } from './new-campaign'

export const maxDuration = 300

export const metadata = { title: 'New campaign' }

export default async function NewCampaignPage() {
  const searches = (await db()`
    select s.id, s.label, count(l.id)::int as leads
      from searches s left join leads l on l.search_id = s.id
     group by s.id, s.label having count(l.id) > 0
     order by s.created_at desc`) as { id: number; label: string; leads: number }[]

  const mailboxes = (await db()`
    select id, name, from_email, is_default from mailboxes order by is_default desc, id`) as {
    id: number
    name: string
    from_email: string
    is_default: boolean
  }[]

  return (
    <>
      <PageHeader
        title="New campaign"
        description="Describe what you want to sell and let Claude draft it, or fill it in yourself."
      />
      <NewCampaign searches={searches} mailboxes={mailboxes} />
    </>
  )
}
