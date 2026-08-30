import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { db, type Campaign, type Lead } from '@/lib/db'
import { LEADS_PER_PAGE, LEAD_SORTS, leadFilter } from '@/lib/leads'
import { orderBy, sortFromParams } from '@/lib/sort'

/** Only what the table draws. `select l.*` also dragged `raw` and `research` — a full
 *  Apify row and a research essay per lead — through the RSC payload for nothing. */
export type LeadRow = Pick<
  Lead,
  'id' | 'full_name' | 'email' | 'job_title' | 'company_name' | 'industry' | 'company_size'
> & { contacted: boolean; replied: boolean }

import { LeadFilters } from './lead-filters'
import { LeadsTable } from './leads-table'

export const metadata = { title: 'Leads' }

export default async function LeadsPage({ searchParams }: PageProps<'/leads'>) {
  const params = await searchParams
  const query = typeof params.q === 'string' ? params.q.trim() : ''
  const source = Number(params.source) || null
  const page = Math.max(1, Number(params.page) || 1)
  // Sorting has to happen in the database: ordering the hundred rows on this page would
  // put the first name on the page in front, not the first name in the search.
  const sort = sortFromParams(params, Object.keys(LEAD_SORTS) as (keyof typeof LEAD_SORTS)[])

  const { where, params: filterParams } = leadFilter({ query, source })

  const [rows, [{ total }]] = (await Promise.all([
    db().query(
      `select l.id, l.full_name, l.email, l.job_title, l.company_name, l.industry,
              l.company_size,
              exists (select 1 from messages m
                       where m.lead_id = l.id and m.status = 'sent') as contacted,
              exists (select 1 from messages m
                       where m.lead_id = l.id and m.replied_at is not null) as replied
         from leads l
        where ${where}
        order by ${orderBy(LEAD_SORTS, sort, 'l.created_at desc')}
        limit $3 offset $4`,
      [...filterParams, LEADS_PER_PAGE, (page - 1) * LEADS_PER_PAGE],
    ),
    db().query(`select count(*)::int as total from leads l where ${where}`, filterParams),
  ])) as [LeadRow[], { total: number }[]]

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
        description="Everything the searches have found. Filter by source, then add people to a campaign. Scoring happens there."
      />

      <LeadFilters
        query={query}
        source={source}
        searches={searches}
      />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {total === 0 ? (
              <>
                No leads here yet. Start a{' '}
                <Link href="/searches" className="text-primary underline">
                  search
                </Link>{' '}
                to import some.
              </>
            ) : (
              <>
                Page {page} is past the end of {total.toLocaleString('sv-SE')} leads —{' '}
                <Link href="/leads" className="text-primary underline">
                  back to the first page
                </Link>
                .
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <LeadsTable
          leads={rows}
          campaigns={campaigns}
          total={total}
          page={page}
          perPage={LEADS_PER_PAGE}
          filter={{ query, source }}
          sort={sort}
        />
      )}
    </>
  )
}
