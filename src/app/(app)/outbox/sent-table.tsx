'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Fragment, useState } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { SortHeader } from '@/components/sortable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { blockLeads, markEnrollmentReplied } from '@/lib/actions'
import { sortRows, type Sort } from '@/lib/sort'
import { cn } from '@/lib/utils'
import type { OutboxRow } from './page'

/** What each reading means, and how loudly to say it. */
const INTENT: Record<string, { label: string; className: string }> = {
  interested: { label: 'interested', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  question: { label: 'question', className: 'bg-green-500/15 text-green-700 dark:text-green-400' },
  not_now: { label: 'later', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  referral: { label: 'referred on', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  not_interested: { label: 'not interested', className: 'bg-muted text-muted-foreground' },
  opt_out: { label: 'asked to stop', className: 'bg-destructive/15 text-destructive' },
  other: { label: 'replied', className: 'bg-muted text-muted-foreground' },
}

const SENT_AT = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
})

type SortKey = 'lead' | 'subject' | 'campaign' | 'sent' | 'engagement'

/** Replied beats clicked beats opened, so sorting brings the warmest to the top. */
const WARMTH: Record<string, number> = {
  interested: 6,
  question: 6,
  not_now: 5,
  referral: 4,
  other: 3,
  not_interested: 2,
  opt_out: 1,
}

const engagement = (m: OutboxRow) =>
  (m.replied_at ? 100 + (WARMTH[m.reply_intent ?? ''] ?? 0) : 0) +
  (m.clicked_at ? 10 : 0) +
  (m.opened_at ? 1 : 0)

const sortValue = (m: OutboxRow, key: SortKey): string | number => {
  switch (key) {
    case 'lead':
      return m.lead_name || m.email
    case 'subject':
      return m.subject
    case 'campaign':
      return m.campaign_name
    case 'sent':
      return Date.parse(m.sent_at ?? '') || 0
    case 'engagement':
      return engagement(m)
  }
}

/**
 * What has gone out, and what to do about it.
 *
 * This was a stack of cards you could only read. The two things you actually want when
 * someone answers are here now: end their sequence, or block the address for good. Both
 * were a trip to another page before, which is how a reply turns into a follow-up nobody
 * meant to send.
 */
export function SentTable({ messages, signatureFor }: {
  messages: OutboxRow[]
  signatureFor: Record<number, string>
}) {
  const [sort, setSort] = useState<Sort<SortKey> | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  /**
   * Delivered by default.
   *
   * A rejection is worth keeping and worth reading, but it is not what this tab is for,
   * and mixing the two makes every count on the page mean two things at once.
   */
  const [show, setShow] = useState<'sent' | 'failed' | 'all'>('sent')

  const delivered = messages.filter((m) => m.status === 'sent').length
  const rejected = messages.length - delivered

  // Everything on screen is already loaded, so filtering here beats a round trip.
  const needle = query.trim().toLowerCase()
  const visible = messages.filter((m) => show === 'all' || m.status === show)
  const found = needle
    ? visible.filter((m) =>
        [m.lead_name, m.email, m.subject, m.campaign_name, m.company_name, m.reply_summary, m.reply_text]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
      )
    : visible
  const rows = sortRows(found, sort, sortValue)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, company, subject or campaign…"
          className="h-9 w-full sm:w-96"
          aria-label="Search sent emails"
        />
        <Button
          size="sm"
          variant={show === 'sent' ? 'secondary' : 'ghost'}
          onClick={() => setShow('sent')}
        >
          Delivered {delivered}
        </Button>
        {rejected > 0 ? (
          <>
            <Button
              size="sm"
              variant={show === 'failed' ? 'secondary' : 'ghost'}
              onClick={() => setShow('failed')}
            >
              Failed {rejected}
            </Button>
            <Button
              size="sm"
              variant={show === 'all' ? 'secondary' : 'ghost'}
              onClick={() => setShow('all')}
            >
              All {messages.length}
            </Button>
          </>
        ) : null}
        <span className="text-muted-foreground text-xs tabular-nums">
          {needle ? `${rows.length} shown` : ''}
        </span>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <SortHeader label="Lead" sortKey="lead" sort={sort} onSort={setSort} />
                <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={setSort} />
                <SortHeader
                  label="Campaign"
                  sortKey="campaign"
                  sort={sort}
                  onSort={setSort}
                  className="w-44"
                />
                <SortHeader
                  label="Sent"
                  sortKey="sent"
                  sort={sort}
                  onSort={setSort}
                  className="w-32"
                />
                <SortHeader
                  label="Result"
                  sortKey="engagement"
                  sort={sort}
                  onSort={setSort}
                  className="w-44"
                />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((message) => (
                <Fragment key={message.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setExpanded(expanded === message.id ? null : message.id)}
                  >
                    <TableCell>
                      <ChevronRight
                        className={cn(
                          'text-muted-foreground size-4 transition-transform',
                          expanded === message.id && 'rotate-90',
                        )}
                      />
                    </TableCell>
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Link
                        href={`/leads/${message.lead_id}`}
                        className="font-medium hover:underline"
                      >
                        {message.lead_name || message.email}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {message.company_name ?? message.email}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">{message.subject}</TableCell>
                    <TableCell className="text-muted-foreground truncate text-xs">
                      {message.campaign_name} · step {message.step + 1}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {message.sent_at ? SENT_AT.format(new Date(message.sent_at)) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {message.replied_at ? (
                          <Badge
                            className={INTENT[message.reply_intent ?? 'other']?.className}
                            variant="secondary"
                          >
                            {INTENT[message.reply_intent ?? 'other']?.label ?? 'replied'}
                          </Badge>
                        ) : null}
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
                        {message.status === 'failed' ? (
                          <Badge variant="destructive">failed</Badge>
                        ) : null}
                        {!message.replied_at &&
                        !message.clicked_at &&
                        !message.opened_at &&
                        message.status !== 'failed' ? (
                          <span className="text-muted-foreground text-xs">no reply yet</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right whitespace-nowrap"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {!message.replied_at ? (
                        <ConfirmButton
                          action={markEnrollmentReplied}
                          payload={{ enrollmentId: message.enrollment_id }}
                          title="Mark this lead as replied?"
                          description="Ends this campaign's sequence for them and drops any email still waiting to go out. Other campaigns keep running. Use this when someone answers by phone or from another address."
                          confirmLabel="Mark replied"
                          pendingLabel="Saving…"
                        >
                          Mark replied
                        </ConfirmButton>
                      ) : null}
                      <ConfirmButton
                        action={blockLeads}
                        payload={{ leadId: message.lead_id }}
                        className="text-destructive"
                        title={`Block ${message.lead_name || message.email}?`}
                        description="What to press when someone asks to be left alone. Their address goes on the blocked list: every campaign drops them, anything waiting is dropped, and a later search cannot bring them back."
                        confirmLabel="Block"
                        pendingLabel="Blocking…"
                      >
                        Block
                      </ConfirmButton>
                    </TableCell>
                  </TableRow>

                  {expanded === message.id ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-muted/30">
                        <div className="max-w-3xl space-y-3 py-2">
                          <Link
                            href={`/leads/${message.lead_id}`}
                            className="text-muted-foreground text-xs hover:underline"
                          >
                            {message.email} →
                          </Link>
                          {message.reply_text ? (
                            <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3">
                              <div className="mb-1 text-xs font-medium">
                                They replied
                                {message.reply_summary ? (
                                  <span className="text-muted-foreground font-normal">
                                    {' '}
                                    · {message.reply_summary}
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-sm whitespace-pre-wrap">{message.reply_text}</p>
                              {message.reply_intent === 'opt_out' ? (
                                <p className="text-destructive mt-2 text-xs">
                                  Blocked automatically. They will not be written to again from
                                  any campaign.
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="font-medium">{message.subject}</div>
                          <p className="text-sm whitespace-pre-wrap">{message.body}</p>
                          {signatureFor[message.campaign_id] ? (
                            <p className="text-muted-foreground border-l-2 pl-3 text-sm whitespace-pre-wrap">
                              {signatureFor[message.campaign_id]}
                            </p>
                          ) : null}
                          {message.error ? (
                            <p className="text-destructive text-xs">{message.error}</p>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="text-muted-foreground py-6 text-center text-sm">
          {needle ? `Nothing matches “${query}”.` : 'Nothing here.'}
        </p>
      ) : null}
    </div>
  )
}
