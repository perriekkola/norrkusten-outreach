import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { db, type Campaign, type Lead } from '@/lib/db'
import { LeadsTable } from './leads-table'

const STATUSES = ['all', 'new', 'qualified', 'rejected', 'contacted', 'replied', 'won', 'lost']

export default async function LeadsPage({ searchParams }: PageProps<'/leads'>) {
  const params = await searchParams
  const status = typeof params.status === 'string' ? params.status : 'all'
  const query = typeof params.q === 'string' ? params.q.trim() : ''

  const leads = (await db()`
    select * from leads
     where (${status} = 'all' or status = ${status})
       and (${query} = '' or
            full_name ilike ${'%' + query + '%'} or
            email ilike ${'%' + query + '%'} or
            company_name ilike ${'%' + query + '%'} or
            job_title ilike ${'%' + query + '%'})
     order by score desc nulls last, created_at desc
     limit 300`) as Lead[]

  const campaigns = (await db()`
    select id, name from campaigns where status = 'active' order by name`) as Pick<
    Campaign,
    'id' | 'name'
  >[]

  return (
    <>
      <PageHeader
        title="Leads"
        description="Select rows, then qualify, research or enroll them in a campaign."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUSES.map((value) => (
          <Link key={value} href={`/leads${value === 'all' ? '' : `?status=${value}`}`}>
            <Badge variant={status === value ? 'default' : 'outline'} className="capitalize">
              {value}
            </Badge>
          </Link>
        ))}
        <form className="ml-auto">
          {status !== 'all' ? <input type="hidden" name="status" value={status} /> : null}
          <input
            name="q"
            defaultValue={query}
            placeholder="Search name, company, title…"
            className="border-input bg-background h-9 w-64 rounded-md border px-3 text-sm"
          />
        </form>
      </div>

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
