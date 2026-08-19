import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { runTick } from '@/lib/actions'
import { db } from '@/lib/db'

type Stats = {
  leads: number
  qualified: number
  contacted: number
  replied: number
  drafts: number
  sent7: number
  running: number
  campaigns: number
}

async function stats(): Promise<Stats> {
  const [row] = (await db()`
    select
      (select count(*) from leads)::int                                            as leads,
      (select count(*) from leads where status = 'qualified')::int                 as qualified,
      (select count(*) from leads where status = 'contacted')::int                 as contacted,
      (select count(*) from leads where status = 'replied')::int                   as replied,
      (select count(*) from messages where status in ('draft','approved'))::int    as drafts,
      (select count(*) from messages where status = 'sent'
         and sent_at > now() - interval '7 days')::int                             as sent7,
      (select count(*) from searches where status = 'running')::int                as running,
      (select count(*) from campaigns where status = 'active')::int                as campaigns
  `) as Stats[]
  return row
}

const TILES = [
  { key: 'leads', label: 'Leads', href: '/leads' },
  { key: 'qualified', label: 'Qualified', href: '/leads?status=qualified' },
  { key: 'contacted', label: 'Contacted', href: '/leads?status=contacted' },
  { key: 'replied', label: 'Replied', href: '/leads?status=replied' },
  { key: 'drafts', label: 'Waiting in outbox', href: '/outbox' },
  { key: 'sent7', label: 'Sent (7 days)', href: '/outbox?tab=sent' },
  { key: 'running', label: 'Searches running', href: '/searches' },
  { key: 'campaigns', label: 'Active campaigns', href: '/campaigns' },
] as const

export default async function DashboardPage() {
  let data: Stats | null = null
  let error: string | null = null
  try {
    data = await stats()
  } catch (caught) {
    error = String(caught)
  }

  return (
    <>
      <PageHeader title="Dashboard" description="Pipeline at a glance.">
        <form action={runTick}>
          <SubmitButton variant="outline" size="sm" pendingLabel="Running…">
            Run pipeline now
          </SubmitButton>
        </form>
      </PageHeader>

      {error ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-destructive text-base">Database not ready</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 text-sm">
            <p className="break-words">{error}</p>
            <p>
              Set <code>DATABASE_URL</code> in your environment and run{' '}
              <code>npm run db:push</code>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {TILES.map((tile) => (
            <Link key={tile.key} href={tile.href}>
              <Card className="hover:border-primary/50 h-full transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {tile.label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold tabular-nums">{data?.[tile.key] ?? 0}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {[
          {
            title: '1. Find',
            body: 'Run an Apify search with your targeting filters. Results import automatically.',
            href: '/searches',
            cta: 'New search',
          },
          {
            title: '2. Qualify',
            body: 'Claude scores each lead against your ICP and researches the company on the web.',
            href: '/leads',
            cta: 'Open leads',
          },
          {
            title: '3. Reach out',
            body: 'Enroll leads in a campaign. Drafts wait in the outbox until you approve them.',
            href: '/campaigns',
            cta: 'Campaigns',
          },
        ].map((step) => (
          <Card key={step.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">{step.body}</p>
              <Link href={step.href}>
                <Badge variant="secondary">{step.cta} →</Badge>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
