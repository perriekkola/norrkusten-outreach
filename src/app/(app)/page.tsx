import Link from 'next/link'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { PageHeader } from '@/components/page-header'
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
      (select count(distinct e.lead_id) from enrollments e
         join campaigns c on c.id = e.campaign_id
        where e.score >= c.min_score)::int                                         as qualified,
      (select count(distinct lead_id) from messages where status = 'sent')::int    as contacted,
      (select count(distinct lead_id) from messages where replied_at is not null)::int as replied,
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
  { key: 'qualified', label: 'Above floor', href: '/campaigns' },
  { key: 'contacted', label: 'Contacted', href: '/analytics' },
  { key: 'replied', label: 'Replied', href: '/analytics' },
  { key: 'drafts', label: 'Waiting in outbox', href: '/outbox' },
  { key: 'sent7', label: 'Sent (7 days)', href: '/analytics' },
  { key: 'running', label: 'Searches running', href: '/searches' },
  { key: 'campaigns', label: 'Active campaigns', href: '/campaigns' },
] as const

export const metadata = { title: 'Dashboard' }

// "Run everything now" calls the same tick the schedule does, and drafting can take
// minutes. Without this the action is cut off at the default limit.
export const maxDuration = 300

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
      <PageHeader title="Dashboard" description="Where everything stands right now.">
        <div className="flex shrink-0 items-center gap-1.5">
          <ConfirmButton
            action={runTick}
            payload={{}}
            variant="outline"
            title="Do everything now?"
            description="Sends everything already approved, then brings in finished searches, checks for replies and runs every active campaign. The approved emails go to real leads immediately."
            confirmLabel="Run it"
            pendingLabel="Running…"
          >
            Run everything now
          </ConfirmButton>
          <Hint>
            Does everything the twice-daily round does, right now. It sends approved mail
            first, then brings in finished searches, checks replies and runs each active
            campaign. This is the only button on this page that can deliver an email.
          </Hint>
        </div>
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
            body: 'Search for leads matching your filters. Finished searches arrive on their own.',
            href: '/searches',
            cta: 'New search',
          },
          {
            title: '2. Target',
            body:
              'Give a campaign its own profile and tick the searches it should feed on. It ' +
              'enrols and scores those leads itself, and ignores anything under its floor.',
            href: '/campaigns',
            cta: 'Campaigns',
          },
          {
            title: '3. Approve',
            body:
              'Emails are written for you, best score first, and wait in the outbox. ' +
              'Nothing sends until you approve it, unless the campaign is set to send ' +
              'without approval.',
            href: '/outbox',
            cta: 'Outbox',
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
