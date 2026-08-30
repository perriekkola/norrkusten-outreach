import Link from 'next/link'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
 * The schedule lives in vercel.json and Vercel reads it as UTC, so the local times are
 * derived rather than typed — printing "07:00" next to a Swedish clock showing 09:00 is
 * how someone concludes the cron is broken.
 */
const CRON_UTC_HOURS = [7, 13]

const localHours = (offset: number) =>
  CRON_UTC_HOURS.map((hour) => `${String((hour + offset) % 24).padStart(2, '0')}:00`).join(
    ' and ',
  )

function Schedule({ cap, cooldown, auto }: { cap: number; cooldown: number; auto: number }) {
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-base">How the cron works</CardTitle>
        <CardDescription>
          Vercel Cron calls <code>/api/cron</code> twice a day, at{' '}
          <strong>{CRON_UTC_HOURS.map((h) => `${String(h).padStart(2, '0')}:00`).join(' and ')} UTC</strong>{' '}
          — {localHours(2)} Swedish summer time, {localHours(1)} in winter. Nothing else runs on
          a timer; every other button on this site does the same work on demand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5">
          <li>Imports any Apify search that finished since the last run.</li>
          <li>
            Reads the mailboxes over IMAP. A reply ends that lead&apos;s sequence and skips
            their pending drafts — deliberately first, so nobody who answered gets written to.
          </li>
          <li>
            Per active campaign: enrols new leads from its source searches, scores the
            unscored against its ICP, then researches and writes drafts for whatever is due,
            best score first.
          </li>
          <li>
            Sends every message marked <em>approved</em>, again best score first.
          </li>
        </ol>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <div className="font-medium tabular-nums">
              {Math.ceil(cap / 2)} per run · {cap} per day
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Per mailbox, counted over a rolling 24 hours. 30–50 a day is the band where a
              warmed domain stays out of trouble; above 50 reputation damage climbs sharply.
              Two runs a day means each takes half. Anything over the cap waits for the next
              run — it is not dropped.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium tabular-nums">
              {cooldown === 0 ? 'No cooldown' : `${cooldown}-day gap per person`}
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Across every campaign. Five campaigns pulling from overlapping searches will
              pick the same person five times; the recipient just sees one sender mailing
              them five times.
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <div className="font-medium">Approval still gates it</div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              The cron sends what is approved. It never approves anything itself — except for
              campaigns with auto-send on, whose drafts arrive already approved.
            </p>
          </div>
        </div>
        {auto > 0 ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
            <strong>
              {auto} of the {auto === 1 ? 'email' : 'emails'} waiting below{' '}
              {auto === 1 ? 'was' : 'were'} written by a campaign with auto-send on.
            </strong>{' '}
            Nobody needs to approve {auto === 1 ? 'it' : 'them'} — {auto === 1 ? 'it goes' : 'they go'}{' '}
            out at the next cron run. Discard {auto === 1 ? 'it' : 'them'}, or pause the
            campaign, if that is not what you want.
          </p>
        ) : null}
      </CardContent>
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
        description="Drafts wait here until you approve them. The cron sends everything approved twice a day — or press Send now."
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
