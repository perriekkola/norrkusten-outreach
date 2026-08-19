import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { db, type Campaign, type Lead } from '@/lib/db'

export type LeadRow = Lead & { contacted: boolean; replied: boolean }
import { LeadFilters } from './lead-filters'
import { LeadsTable } from './leads-table'

export default async function LeadsPage({ searchParams }: PageProps<'/leads'>) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.trim() : ''
  const source = Number(params.source) || null

  const leads = (await db()`
    select l.*,
           exists (select 1 from messages m
                    where m.lead_id = l.id and m.status = 'sent') as contacted,
           exists (select 1 from messages m
                    where m.lead_id = l.id and m.replied_at is not null) as replied
      from leads l
     where (${source}::int is null or search_id = ${source}::int)
       and (${query} = '' or
            full_name ilike ${'%' + query + '%'} or
            email ilike ${'%' + query + '%'} or
            company_name ilike ${'%' + query + '%'} or
            job_title ilike ${'%' + query + '%'})
     order by created_at desc
     limit 300`) as LeadRow[]

  const campaigns = (await db()`
    select id, name from campaigns where status = 'active' order by name`) as Pick<
    Campaign,
    'id' | 'name'
  >[]

  const searches = (await db()`
    select s.id, s.label, count(l.id)::int as leads
      from searches s left join leads l on l.search_id = s.id
     group by s.id, s.label having count(l.id) > 0
     order by s.created_at desc`) as { id: number; label: string; leads: number }[]

  return (
    <>
      <PageHeader
        title="Leads"
        description="The raw pool. Filter by source, then enroll into a campaign — scoring happens there."
      />

      <LeadFilters
        query={query}
        source={source}
        searches={searches}
      />

      {leads.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No leads here yet. Start a{' '}
            <Link href="/searches" className="text-primary underline">
              search
            </Link>{' '}
            to import some.
          </CardContent>
        </Card>
      ) : (
        <LeadsTable leads={leads} campaigns={campaigns} />
      )}
    </>
  )
}
