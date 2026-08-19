import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db, type Campaign } from '@/lib/db'

type Row = Campaign & { enrolled: number; sent: number; replied: number }

export default async function CampaignsPage() {
  const campaigns = (await db()`
    select c.*,
           (select count(*) from enrollments e where e.campaign_id = c.id)::int as enrolled,
           (select count(*) from messages m join enrollments e on e.id = m.enrollment_id
             where e.campaign_id = c.id and m.status = 'sent')::int as sent,
           (select count(*) from enrollments e
             where e.campaign_id = c.id and e.status = 'replied')::int as replied
      from campaigns c order by c.created_at desc`) as Row[]

  return (
    <>
      <PageHeader title="Campaigns" description="Email sequences with AI-written steps.">
        <Link href="/campaigns/new">
          <Button size="sm">New campaign</Button>
        </Link>
      </PageHeader>

      {campaigns.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No campaigns yet.{' '}
            <Link href="/campaigns/new" className="text-primary underline">
              Create the first one
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
              <Card className="hover:border-primary/50 h-full transition-colors">
                <CardHeader className="flex-row items-start justify-between gap-3">
                  <CardTitle className="text-base">{campaign.name}</CardTitle>
                  <div className="flex gap-2">
                    {campaign.auto_send ? <Badge variant="secondary">auto-send</Badge> : null}
                    <Badge variant={campaign.status === 'active' ? 'default' : 'outline'}>
                      {campaign.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground line-clamp-2 text-sm">
                    {campaign.offer || 'No offer described yet.'}
                  </p>
                  <div className="mt-4 flex gap-6 text-sm">
                    {[
                      ['Steps', campaign.steps.length],
                      ['Enrolled', campaign.enrolled],
                      ['Sent', campaign.sent],
                      ['Replied', campaign.replied],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <div className="text-muted-foreground text-xs">{label}</div>
                        <div className="font-medium tabular-nums">{value}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
