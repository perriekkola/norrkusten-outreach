import { ActivityChart, type ActivityPoint } from '@/components/activity-chart'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/lib/db'

type Funnel = {
  leads: number
  qualified: number
  enrolled: number
  sent: number
  opened: number
  replied: number
  bounced: number
}

type CampaignRow = {
  id: number
  name: string
  enrolled: number
  sent: number
  opened: number
  replied: number
}

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'

export default async function AnalyticsPage() {
  const [funnel] = (await db()`
    select
      (select count(*) from leads)::int                                                as leads,
      (select count(distinct lead_id) from enrollments
        where score >= 50)::int                                                        as qualified,
      (select count(distinct lead_id) from enrollments)::int                           as enrolled,
      (select count(*) from messages where status = 'sent')::int                       as sent,
      (select count(*) from messages where opened_at is not null)::int                 as opened,
      (select count(*) from messages where replied_at is not null)::int                as replied,
      (select count(*) from enrollments where status = 'bounced')::int                 as bounced
  `) as Funnel[]

  const activity = (await db()`
    select to_char(d::date, 'YYYY-MM-DD') as day,
      (select count(*) from messages
        where sent_at >= d and sent_at < d + interval '1 day')::int    as sent,
      (select count(*) from messages
        where opened_at >= d and opened_at < d + interval '1 day')::int as opened,
      (select count(*) from messages
        where replied_at >= d and replied_at < d + interval '1 day')::int as replied
      from generate_series(current_date - 29, current_date, interval '1 day') d
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
      from campaigns c order by c.created_at desc`) as CampaignRow[]

  const STAGES = [
    { label: 'Leads', value: funnel.leads, rate: null },
    { label: 'Qualified', value: funnel.qualified, rate: percent(funnel.qualified, funnel.leads) },
    { label: 'Enrolled', value: funnel.enrolled, rate: percent(funnel.enrolled, funnel.qualified) },
    { label: 'Emails sent', value: funnel.sent, rate: null },
    { label: 'Opened', value: funnel.opened, rate: percent(funnel.opened, funnel.sent) },
    { label: 'Replied', value: funnel.replied, rate: percent(funnel.replied, funnel.sent) },
  ]

  return (
    <>
      <PageHeader title="Analytics" description="Funnel, activity and per-campaign performance." />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
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
            <CardTitle className="text-base">Last 30 days</CardTitle>
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
              <strong className="text-foreground">Replies</strong> are matched over IMAP on the
              actual mail headers, so they are exact — and a reply stops that lead&apos;s sequence
              automatically.
            </p>
            <p>
              <strong className="text-foreground">Bounces</strong> come back as mail to your inbox
              with plain SMTP. {funnel.bounced} enrollment(s) are currently marked bounced.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">By campaign</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          {campaigns.length === 0 ? (
            <p className="text-muted-foreground px-6 text-sm">No campaigns yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Enrolled</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell className="font-medium">{campaign.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{campaign.enrolled}</TableCell>
                    <TableCell className="text-right tabular-nums">{campaign.sent}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.opened}{' '}
                      <span className="text-muted-foreground text-xs">
                        {percent(campaign.opened, campaign.sent)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {campaign.replied}{' '}
                      <span className="text-muted-foreground text-xs">
                        {percent(campaign.replied, campaign.sent)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
