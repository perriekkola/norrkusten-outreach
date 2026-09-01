import { ActivityChart, type ActivityPoint } from '@/components/activity-chart'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { AnalyticsFilters } from './analytics-filters'
import { CampaignsTable } from './campaigns-table'

type Funnel = {
  leads: number
  qualified: number
  enrolled: number
  sent: number
  opened: number
  clicked: number
  replied: number
  bounced: number
}

export type CampaignRow = {
  id: number
  name: string
  enrolled: number
  sent: number
  opened: number
  replied: number
}

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'

export const metadata = { title: 'Analytics' }

export default async function AnalyticsPage({ searchParams }: PageProps<'/analytics'>) {
  const params = await searchParams
  const campaign = Number(params.campaign) || null
  const from = typeof params.from === 'string' ? params.from : ''
  const to = typeof params.to === 'string' ? params.to : ''
  // Inclusive end date: `< to + 1 day` rather than `<= to`, which would drop same-day rows.
  // Null, not '': Postgres folds `''::date` before the OR guard can short-circuit and errors.
  const fromDate = from || null
  const untilDate = to ? new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10) : null

  const [funnel] = (await db()`
    with scoped as (
      select m.*, e.campaign_id, e.score, e.lead_id as enrolled_lead
        from messages m join enrollments e on e.id = m.enrollment_id
       where (${campaign}::int is null or e.campaign_id = ${campaign}::int)
         and (${fromDate}::date is null or m.sent_at >= ${fromDate}::date)
         and (${untilDate}::date is null or m.sent_at < ${untilDate}::date)
    ),
    pool as (
      select e.* from enrollments e
       where (${campaign}::int is null or e.campaign_id = ${campaign}::int)
    )
    select
      (select count(distinct lead_id) from pool)::int                                  as leads,
      (select count(distinct lead_id) from pool where score >= 50)::int                as qualified,
      (select count(distinct lead_id) from pool)::int                                  as enrolled,
      (select count(*) from scoped where status = 'sent')::int                         as sent,
      (select count(*) from scoped where opened_at is not null)::int                   as opened,
      (select count(*) from scoped where clicked_at is not null)::int                  as clicked,
      (select count(*) from scoped where replied_at is not null)::int                  as replied,
      (select count(*) from pool where status = 'bounced')::int                        as bounced
  `) as Funnel[]

  const activity = (await db()`
    with m as (
      select msg.* from messages msg join enrollments e on e.id = msg.enrollment_id
       where (${campaign}::int is null or e.campaign_id = ${campaign}::int)
    )
    select to_char(d::date, 'YYYY-MM-DD') as day,
      (select count(*) from m
        where sent_at >= d and sent_at < d + interval '1 day')::int      as sent,
      (select count(*) from m
        where opened_at >= d and opened_at < d + interval '1 day')::int  as opened,
      (select count(*) from m
        where replied_at >= d and replied_at < d + interval '1 day')::int as replied
      from generate_series(
             coalesce(${fromDate}::date, current_date - 29),
             coalesce(${to || null}::date, current_date),
             interval '1 day') d
     order by d`) as ActivityPoint[]

  const campaigns = (await db()`
    select c.id, c.name,
           (select count(*) from enrollments e where e.campaign_id = c.id)::int as enrolled,
           (select count(*) from messages m join enrollments e on e.id = m.enrollment_id
             where e.campaign_id = c.id and m.status = 'sent')::int             as sent,
           (select count(*) from messages m join enrollments e on e.id = m.enrollment_id
             where e.campaign_id = c.id and m.opened_at is not null)::int       as opened,
           (select count(*) from messages m join enrollments e on e.id = m.enrollment_id
             where e.campaign_id = c.id and m.replied_at is not null)::int      as replied
      from campaigns c
     where (${campaign}::int is null or c.id = ${campaign}::int)
     order by c.created_at desc`) as CampaignRow[]

  const allCampaigns = (await db()`
    select id, name from campaigns order by created_at desc`) as { id: number; name: string }[]

  const STAGES = [
    { label: campaign ? 'Enrolled' : 'Leads', value: funnel.leads, rate: null },
    { label: 'Qualified', value: funnel.qualified, rate: percent(funnel.qualified, funnel.leads) },
    { label: 'Enrolled', value: funnel.enrolled, rate: percent(funnel.enrolled, funnel.qualified) },
    { label: 'Emails sent', value: funnel.sent, rate: null },
    { label: 'Opened', value: funnel.opened, rate: percent(funnel.opened, funnel.sent) },
    { label: 'Clicked', value: funnel.clicked, rate: percent(funnel.clicked, funnel.sent) },
    { label: 'Replied', value: funnel.replied, rate: percent(funnel.replied, funnel.sent) },
  ]

  return (
    <>
      <PageHeader title="Analytics" description="Funnel, activity and per-campaign performance." />

      <AnalyticsFilters campaign={campaign} from={from} to={to} campaigns={allCampaigns} />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        {STAGES.map((stage) => (
          <Card key={stage.label}>
            <CardContent className="py-4">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {stage.label}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{stage.value}</div>
              {stage.rate ? (
                <div className="text-muted-foreground text-xs tabular-nums">
                  {stage.rate} of previous
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {from && to ? `${from} to ${to}` : 'Last 30 days'}
            </CardTitle>
            <CardDescription>Emails sent, opened and replied to, per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityChart data={activity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How reliable is this?</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-3 text-sm">
            <p>
              <strong className="text-foreground">Opens</strong> use a tracking pixel. Apple Mail
              Privacy Protection and Gmail image proxies pre-load images, so treat open rate as a
              trend, not a headcount.
            </p>
            <p>
              <strong className="text-foreground">Clicks</strong> are exact — links in sent mail
              are rewritten through a signed redirect, so a click is a real human action rather
              than a proxy prefetch. Better signal than opens.
            </p>
            <p>
              <strong className="text-foreground">Replies</strong> are matched by reading the inbox on the
              actual mail headers, so they are exact — and a reply stops that lead&apos;s sequence
              automatically.
            </p>
            <p>
              <strong className="text-foreground">Bounces</strong> arrive as an ordinary
              undelivered-mail reply in your inbox rather than being counted here, so this
              number only moves when one is recorded by hand. {funnel.bounced} lead(s) are
              currently marked as bounced.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 py-0">
        <CardContent className="p-0">
          {campaigns.length === 0 ? (
            <p className="text-muted-foreground p-6 text-sm">No campaigns yet.</p>
          ) : (
            <CampaignsTable campaigns={campaigns} />
          )}
        </CardContent>
      </Card>
    </>
  )
}
