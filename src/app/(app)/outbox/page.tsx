import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UrlTabs } from '@/components/url-tabs'
import { DraftButton } from './draft-button'
import { db, getSetting } from '@/lib/db'
import { dailySendCap, leadCooldownDays, roundsPerDay } from '@/lib/engine'
import { OutboxTable } from './outbox-table'
import { SentTable } from './sent-table'
import { RepliesTable } from './replies-table'

export type OutboxRow = {
  id: number
  enrollment_id: number
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
  reply_text: string | null
  reply_intent: string | null
  reply_summary: string | null
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
  select m.id, m.enrollment_id, m.subject, m.body, m.status, m.step, m.sent_at, m.opened_at,
         m.replied_at, m.reply_text, m.reply_intent, m.reply_summary,
         m.created_at,
         m.open_count, m.clicked_at, m.click_count, m.error, l.id as lead_id, l.full_name as lead_name, l.email,
         l.company_name, c.name as campaign_name, c.id as campaign_id, c.auto_send
    from messages m
    join leads l on l.id = m.lead_id
    join enrollments e on e.id = m.enrollment_id
    join campaigns c on c.id = e.campaign_id`

/**
 * How many rows any one tab loads.
 *
 * These lists are filtered, searched and sorted in the browser, so the whole set has to be
 * on the page. It was 100 for sent mail, which quietly hid everything older than the last
 * hundred — the list looked complete and was not. High enough now that nothing realistic
 * hits it, and when something does, {@link Truncated} says so rather than the list just
 * stopping.
 *
 * ponytail: whole list in the browser; page it server-side when this cap is reached in
 * practice rather than in theory.
 */
const LIST_LIMIT = 1000

/** Says the quiet part out loud on the day a list stops being all of it. */
function Truncated({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null
  return (
    <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
      Showing the {shown} most recent of {total}. The older ones are not on this page.
    </p>
  )
}

export const metadata = { title: 'Outbox' }

function Schedule({
  cap,
  cooldown,
  auto,
  rounds,
}: {
  cap: number
  cooldown: number
  auto: number
  rounds: number
}) {
  // Read from the setting, not from vercel.json. The schedule can come from there, from a
  // GitHub Action or from a crontab, and this card claiming "twice a day, 09:00 and 15:00"
  // while twenty-two rounds actually run is worse than saying nothing.
  const perRound = Math.ceil(cap / Math.max(1, rounds))
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
            {rounds} {rounds === 1 ? 'round' : 'rounds'} a day
          </span>
        </summary>

        <CardContent className="space-y-4 px-6 pb-6 text-sm">
          <p className="text-muted-foreground">
            <strong>{rounds} times a day</strong> the site does a round of work by itself,
            sending a little each time rather than everything at once. Nothing else happens on
            a timer. Every other button here does the same jobs straight away when you press
            it.
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
              {perRound} per round · {cap} per day
            </div>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              Counted per sending address over the last 24 hours, not per calendar day. Around
              30 to 50 a day is where an established address stays out of trouble. Much above
              50 and inbox providers start treating everything from your domain as spam, good
              campaigns included. The day&apos;s allowance is split across the {rounds} rounds,
              so each one sends a few. Anything over the limit waits for the next round. It is
              never thrown away.
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
      order by e.score desc nulls last, m.step, m.id limit ${LIST_LIMIT}`,
  )) as OutboxRow[]

  // Only worth saying while it is actually happening. A refused message keeps its error
  // text until it sends, so hours after a burst the count is still high even though every
  // round since went through cleanly — which reads as an unresolved problem when there
  // is none. The last round's own verdict is what decides whether to say anything.
  const throttledLastRound = (await getSetting('last_round_throttled', 'no')) === 'yes'
  const [heldBack] = (await db()`
    select count(*)::int as n from messages
     where status = 'approved' and error is not null`) as { n: number }[]

  // Counted in the database, not from the arrays above. A badge built from a capped list
  // reports the cap, which is how 230 sent emails read as 100.
  const [totals] = (await db()`
    select count(*) filter (where status in ('draft','approved'))::int as pending,
           count(*) filter (where status = 'sent')::int as delivered,
           count(*) filter (where status in ('sent','failed'))::int as sent_or_failed,
           count(*) filter (where replied_at is not null)::int as replies
      from messages`) as {
    pending: number
    delivered: number
    sent_or_failed: number
    replies: number
  }[]

  const testEmail = await getSetting('test_email')
  const [cap, cooldown, rounds] = await Promise.all([
    dailySendCap(),
    leadCooldownDays(),
    roundsPerDay(),
  ])
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
    `${SELECT} where m.status in ('sent','failed') order by m.sent_at desc nulls last limit ${LIST_LIMIT}`,
  )) as OutboxRow[]

  // Replies are the whole output of this thing, so they get their own list rather than
  // being a badge somewhere in a hundred rows of sent mail.
  const replies = (await db().query(
    `${SELECT} where m.replied_at is not null order by m.replied_at desc limit ${LIST_LIMIT}`,
  )) as OutboxRow[]

  return (
    <>
      <PageHeader
        title="Outbox"
        description="Emails wait here until you approve them. Approved ones go out twice a day on their own, or press Send now."
      >
        <DraftButton />
      </PageHeader>

      <Schedule cap={cap} cooldown={cooldown} auto={autoCount} rounds={rounds} />

      {throttledLastRound && heldBack.n > 0 ? (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed">
          <strong>The mail server asked us to slow down on the last round.</strong>{' '}
          {heldBack.n} {heldBack.n === 1 ? 'email is' : 'emails are'} still approved and will
          go out on the following rounds, a few at a time. Nothing has been lost and there is
          nothing to press. If this keeps happening, raise the seconds between emails in
          Settings.
        </p>
      ) : null}

      <UrlTabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending">Waiting ({totals.pending})</TabsTrigger>
          <TabsTrigger value="replies">Replies ({totals.replies})</TabsTrigger>
          {/* Delivered mail only. A sent count that includes rejections is the opposite of
              what it is for; the failures are a filter inside the tab. */}
          <TabsTrigger value="sent">Sent ({totals.delivered})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <Truncated shown={pending.length} total={totals.pending} />
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

        <TabsContent value="replies" className="mt-4">
          <Truncated shown={replies.length} total={totals.replies} />
          <RepliesTable replies={replies} />
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          <Truncated shown={sent.length} total={totals.sent_or_failed} />
          {sent.length === 0 ? (
            <Card>
              <CardContent className="text-muted-foreground py-10 text-center text-sm">
                Nothing sent yet.
              </CardContent>
            </Card>
          ) : (
            <SentTable messages={sent} signatureFor={signatureFor} />
          )}
        </TabsContent>

      </UrlTabs>
    </>
  )
}
