'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { blockLeads, dismissReply } from '@/lib/actions'
import type { OutboxRow } from './page'

const REPLIED_AT = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
})

/** Warmest first, so the ones worth answering today are at the top. */
const ORDER = ['interested', 'question', 'not_now', 'referral', 'other', 'not_interested', 'opt_out']

const INTENT: Record<string, { label: string; className: string }> = {
  interested: { label: 'Interested', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  question: { label: 'Question', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  not_now: { label: 'Later', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  referral: { label: 'Referred on', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  not_interested: { label: 'Not interested', className: 'bg-muted text-muted-foreground' },
  opt_out: { label: 'Asked to stop', className: 'bg-destructive/15 text-destructive' },
  other: { label: 'Replied', className: 'bg-muted text-muted-foreground' },
}

/**
 * Everything anybody has written back, in one place.
 *
 * These were only reachable by opening each mailbox, or by hunting through the sent list a
 * row at a time. Replies are the entire output of the thing, so they get their own page,
 * with what was written shown in full rather than behind a click.
 */
export function RepliesTable({ replies }: { replies: OutboxRow[] }) {
  const [query, setQuery] = useState('')
  const [intent, setIntent] = useState<string | null>(null)

  const needle = query.trim().toLowerCase()
  const rows = replies
    .filter((m) => !intent || (m.reply_intent ?? 'other') === intent)
    .filter(
      (m) =>
        !needle ||
        [m.lead_name, m.email, m.company_name, m.campaign_name, m.reply_text, m.reply_summary]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      const rank = ORDER.indexOf(a.reply_intent ?? 'other') - ORDER.indexOf(b.reply_intent ?? 'other')
      if (rank !== 0) return rank
      return Date.parse(b.replied_at ?? '') - Date.parse(a.replied_at ?? '')
    })

  const counts = replies.reduce<Record<string, number>>((all, m) => {
    const key = m.reply_intent ?? 'other'
    all[key] = (all[key] ?? 0) + 1
    return all
  }, {})

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, company or what they wrote…"
          className="h-9 w-full sm:w-80"
          aria-label="Search replies"
        />
        <Button
          size="sm"
          variant={intent === null ? 'secondary' : 'ghost'}
          onClick={() => setIntent(null)}
        >
          All {replies.length}
        </Button>
        {ORDER.filter((key) => counts[key]).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={intent === key ? 'secondary' : 'ghost'}
            onClick={() => setIntent(intent === key ? null : key)}
          >
            {INTENT[key].label} {counts[key]}
          </Button>
        ))}
      </div>

      {rows.map((message) => (
        <Card key={message.id} className="py-0">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/leads/${message.lead_id}`} className="font-medium hover:underline">
                  {message.lead_name || message.email}
                </Link>
                <div className="text-muted-foreground text-xs">
                  {message.company_name ? `${message.company_name} · ` : ''}
                  {message.campaign_name} · replied{' '}
                  {message.replied_at ? REPLIED_AT.format(new Date(message.replied_at)) : ''}
                </div>
              </div>
              <Badge
                variant="secondary"
                className={INTENT[message.reply_intent ?? 'other']?.className}
              >
                {INTENT[message.reply_intent ?? 'other']?.label ?? 'Replied'}
              </Badge>
            </div>

            {message.reply_text ? (
              <p className="text-sm whitespace-pre-wrap">{message.reply_text}</p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Their reply has not been fetched yet. It arrives on the next round.
              </p>
            )}

            <div className="text-muted-foreground border-t pt-3 text-xs">
              In reply to <span className="text-foreground">{message.subject}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`}>
                  Answer
                </a>
              </Button>
              <ConfirmButton
                action={dismissReply}
                payload={{ messageId: message.id }}
                title="Not actually a reply?"
                description="Use this when something that is not a person answering slipped through, like an assistant forwarding or a ticket system. Their sequence starts again from where it stopped, and anything that was dropped goes back to the outbox as a draft for you to read before it goes out."
                confirmLabel="Not a reply"
                pendingLabel="Undoing…"
              >
                Not a reply
              </ConfirmButton>
              <ConfirmButton
                action={blockLeads}
                payload={{ leadId: message.lead_id }}
                className="text-destructive ml-auto"
                title={`Block ${message.lead_name || message.email}?`}
                description="Their address goes on the blocked list: every campaign drops them, anything waiting is dropped, and a later search cannot bring them back."
                confirmLabel="Block"
                pendingLabel="Blocking…"
              >
                Block
              </ConfirmButton>
            </div>
          </CardContent>
        </Card>
      ))}

      {rows.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            {replies.length === 0
              ? 'Nobody has replied yet.'
              : 'No replies match that.'}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
