import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DraftButton } from './draft-button'
import { db, getSetting } from '@/lib/db'
import { dailySendCap, leadCooldownDays } from '@/lib/engine'
import { OutboxTable } from './outbox-table'

export type OutboxRow = {
  id: number
  subject: string
  body: string
  status: string
  step: number
  sent_at: string | null
  /** When this draft was written — changes every time it is rewritten. */
  created_at: string
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
  campaign_id: number
  auto_send: boolean
}

const SELECT = `
  select m.id, m.subject, m.body, m.status, m.step, m.sent_at, m.opened_at, m.replied_at,
         m.created_at,
         m.open_count, m.clicked_at, m.click_count, m.error, l.id as lead_id, l.full_name as lead_name, l.email,
         l.company_name, c.name as campaign_name, c.id as campaign_id, c.auto_send
    from messages m
    join leads l on l.id = m.lead_id
    join enrollments e on e.id = m.enrollment_id
    join campaigns c on c.id = e.campaign_id`

export const metadata = { title: 'Outbox' }

/**
 * The schedule lives in vercel.json and the host reads it as UTC, so the local times are
 * derived rather than typed — printing "07:00" next to a Swedish clock showing 09:00 is
 * how someone concludes the automation is broken. Only the local times are ever shown:
 * whoever reads this page wants to know when to expect email, not which zone a server
 * keeps its clock in.
 */
const CRON_UTC_HOURS = [7, 13]

const localHours = (offset: number) =>
  CRON_UTC_HOURS.map((hour) => `${String((hour + offset) % 24).padStart(2, '0')}:00`).join(
    ' and ',
  )

function Schedule({ cap, cooldown, auto }: { cap: number; cooldown: number; auto: number }) {
  return (
    <Card className="mb-6 py-0">
      {/* A plain <details>. It is the accordion the browser already ships: keyboard and
          screen-reader behaviour included, open state without React, and it still reads
          fine if the page renders before any JavaScript arrives. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 p-6 [&::-webkit-details-marker]:hidden">
          <ChevronRight className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-90" />
          <span className="text-base leading-none font-semibold">What happens on its own</span>
          <span className="text-muted-foreground ml-auto text-xs">
            Twice a day, {localHours(2)}
          </span>
        </summary>

        <CardContent className="space-y-4 px-6 pb-6 text-sm">
          <p className="text-muted-foreground">
            Twice a day, at <strong>{localHours(2)}</strong> (an hour earlier, {localHours(1)},
            in winter), the site does a round of work by itself. Nothing else happens on a
            timer. Every other button here does the same jobs straight away when you press it.
          </p>
        <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5">
          <li>Collects the leads from any search that has finished since last time.</li>
          <li>
            Checks your inbox for replies. Anyone who has answered is taken out of that
            campaign, and any email still waiting to go to them is dropped. This happens first
            on purpose, so nobody who replied gets written to again.
          </li>
          <li>
            For each running campaign: adds any new leads, gives each one a score for how well
            they match who the campaign is for, then writes the emails that are due, best
            scores first.
          </li>
          <li>
            Sends everything you have <em>approved</em>, again best scores first.
          </li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="font-medium tabular-nums">
              {Math.ceil(cap / 2)} per run · {cap} per day
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Counted per sending address over the last 24 hours, not per calendar day. Around
              30 to 50 a day is where an established address stays out of trouble. Much above
              50 and inbox providers start treating everything from your domain as spam, good
              campaigns included. Two rounds a day means each takes half. Anything over the
              limit waits for the next round. It is never thrown away.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium tabular-nums">
              {cooldown === 0 ? 'No cooldown' : `${cooldown}-day gap per person`}
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Counted across every campaign at once. Several campaigns drawing on similar
              searches will pick the same person more than once, and they do not see five
              campaigns. They see you mailing them five times in a week.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium">Approval still gates it</div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Only emails you have approved are sent. Nothing approves itself, apart from
              campaigns you have switched to send without approval, where the emails arrive
              ready to go.
            </p>
          </div>
        </div>
        {auto > 0 ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
            <strong>
              {auto} of the {auto === 1 ? 'email' : 'emails'} below{' '}
              {auto === 1 ? 'comes' : 'come'} from a campaign set to send without approval.
            </strong>{' '}
            {auto === 1 ? 'It goes' : 'They go'} out at the next round without anyone pressing
            anything. Discard {auto === 1 ? 'it' : 'them'}, or pause the campaign, if that is
            not what you want.
          </p>
        ) : null}
        </CardContent>
      </details>
    </Card>
  )
}

export default async function OutboxPage() {
  const pending = (await db().query(
    // Same order the sender uses, so the queue reads as the order it will go out —
    // and a rewritten draft keeps its place instead of jumping to the bottom.
    `${SELECT} where m.status in ('draft','approved')
      order by e.score desc nulls last, m.step, m.id limit 200`,
  )) as OutboxRow[]

  const testEmail = await getSetting('test_email')
  const [cap, cooldown] = await Promise.all([dailySendCap(), leadCooldownDays()])
  const autoCount = pending.filter((message) => message.auto_send).length

  // What the outbox shows has to be what leaves, so the signature is resolved here.
  const signatures = (await db()`
    select c.id as campaign_id, coalesce(m.signature, d.signature, '') as signature
      from campaigns c
      left join mailboxes m on m.id = c.mailbox_id
      left join mailboxes d on d.is_default
     `) as { campaign_id: number; signature: string }[]
  const signatureFor = Object.fromEntries(signatures.map((r) => [r.campaign_id, r.signature]))

  const sent = (await db().query(
    `${SELECT} where m.status in ('sent','failed') order by m.sent_at desc nulls last limit 100`,
  )) as OutboxRow[]

  return (
    <>
      <PageHeader
        title="Outbox"
        description="Emails wait here until you approve them. Approved ones go out twice a day on their own, or press Send now."
      >
        <DraftButton />
      </PageHeader>

      <Schedule cap={cap} cooldown={cooldown} auto={autoCount} />

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
            <OutboxTable messages={pending} testEmail={testEmail} signatureFor={signatureFor} />
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
