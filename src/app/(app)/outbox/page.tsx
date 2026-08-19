import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DraftButton } from './draft-button'
import { db } from '@/lib/db'
import { OutboxTable } from './outbox-table'

export type OutboxRow = {
  id: number
  subject: string
  body: string
  status: string
  step: number
  sent_at: string | null
  opened_at: string | null
  clicked_at: string | null
  click_count: number
  replied_at: string | null
  open_count: number
  error: string | null
  lead_id: number
  lead_name: string | null
  email: string
  company_name: string | null
  campaign_name: string
}

const SELECT = `
  select m.id, m.subject, m.body, m.status, m.step, m.sent_at, m.opened_at, m.replied_at,
         m.open_count, m.clicked_at, m.click_count, m.error, l.id as lead_id, l.full_name as lead_name, l.email,
         l.company_name, c.name as campaign_name
    from messages m
    join leads l on l.id = m.lead_id
    join enrollments e on e.id = m.enrollment_id
    join campaigns c on c.id = e.campaign_id`

export default async function OutboxPage() {
  const pending = (await db().query(
    `${SELECT} where m.status in ('draft','approved') order by m.created_at limit 200`,
  )) as OutboxRow[]

  const sent = (await db().query(
    `${SELECT} where m.status in ('sent','failed') order by m.sent_at desc nulls last limit 100`,
  )) as OutboxRow[]

  return (
    <>
      <PageHeader
        title="Outbox"
        description="Drafts wait here until you approve them. The cron sends everything approved twice a day — or press Send now."
      >
        <DraftButton />
      </PageHeader>

      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Waiting ({pending.length})</TabsTrigger>
          <TabsTrigger value="sent">Sent ({sent.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          {pending.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                Nothing waiting. Enroll leads in a{' '}
                <Link href="/campaigns" className="text-primary underline">
                  campaign
                </Link>{' '}
                and press “Draft due emails”.
              </CardContent>
            </Card>
          ) : (
            <OutboxTable messages={pending} />
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4 space-y-3">
          {sent.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                Nothing sent yet.
              </CardContent>
            </Card>
          ) : (
            sent.map((message) => (
              <Card key={message.id}>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{message.subject}</div>
                      <div className="text-muted-foreground text-xs">
                        <Link href={`/leads/${message.lead_id}`} className="hover:underline">
                          {message.lead_name || message.email}
                        </Link>
                        {' · '}
                        {message.campaign_name} · step {message.step + 1}
                        {message.sent_at
                          ? ` · ${new Date(message.sent_at).toLocaleString('sv-SE')}`
                          : ''}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {message.replied_at ? <Badge>replied</Badge> : null}
                      {message.clicked_at ? (
                        <Badge>
                          clicked{message.click_count > 1 ? ` ×${message.click_count}` : ''}
                        </Badge>
                      ) : null}
                      {message.opened_at ? (
                        <Badge variant="secondary">
                          opened{message.open_count > 1 ? ` ×${message.open_count}` : ''}
                        </Badge>
                      ) : null}
                      <Badge variant={message.status === 'failed' ? 'destructive' : 'outline'}>
                        {message.status}
                      </Badge>
                    </div>
                  </div>
                  {message.error ? (
                    <p className="text-destructive mt-2 text-xs">{message.error}</p>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </>
  )
}
