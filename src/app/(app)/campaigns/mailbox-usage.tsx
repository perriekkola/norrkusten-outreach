'use client'

import Link from 'next/link'
import { Hint } from '@/components/hint'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type MailboxUsage = {
  id: number
  name: string
  from_email: string
  is_default: boolean
  campaigns: { id: number; name: string; status: string }[]
}

const activeCount = (mailbox: MailboxUsage) =>
  mailbox.campaigns.filter((c) => c.status === 'active').length

const FILTERS = [
  { value: 'all', label: 'All', keep: () => true },
  { value: 'free', label: 'Free', keep: (m: MailboxUsage) => activeCount(m) === 0 },
  { value: 'in-use', label: 'In use', keep: (m: MailboxUsage) => activeCount(m) > 0 },
  { value: 'shared', label: 'Shared', keep: (m: MailboxUsage) => activeCount(m) > 1 },
] as const

function MailboxRow({ mailbox }: { mailbox: MailboxUsage }) {
  const active = activeCount(mailbox)
  return (
    <div className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {mailbox.name}
          {mailbox.is_default ? <Badge variant="secondary">default</Badge> : null}
        </div>
        <div className="text-muted-foreground truncate text-xs">{mailbox.from_email}</div>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm">
        {active === 0 ? (
          <Badge variant="outline" className="border-green-600/40 text-green-700 dark:text-green-400">
            free
          </Badge>
        ) : active > 1 ? (
          <Badge variant="destructive">on {active} active campaigns</Badge>
        ) : null}
        {mailbox.campaigns.map((campaign, i) => (
          <span key={campaign.id} className="inline-flex items-center gap-2">
            {i > 0 ? <span className="text-muted-foreground/60">·</span> : null}
            <Link
              href={`/campaigns/${campaign.id}`}
              className={
                campaign.status === 'active'
                  ? 'hover:text-primary underline-offset-4 hover:underline'
                  : 'text-muted-foreground hover:text-primary underline-offset-4 hover:underline'
              }
            >
              {campaign.name}
              {campaign.status === 'active' ? null : ` (${campaign.status})`}
            </Link>
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * Which mailbox each campaign sends from, seen from the mailbox side: the ones with no
 * active campaign are free to hand out, and one on two active campaigns is usually a
 * mistake — both share its daily volume and its replies land in the same inbox.
 * Collapsed by default so the campaign list stays the first thing on the page.
 */
export function MailboxUsageCard({ mailboxes }: { mailboxes: MailboxUsage[] }) {
  if (mailboxes.length === 0) return null

  const free = mailboxes.filter((m) => activeCount(m) === 0).length
  const shared = mailboxes.filter((m) => activeCount(m) > 1).length

  return (
    <Card className="mb-6 py-0">
      <CardContent>
        <Accordion type="single" collapsible>
          <AccordionItem value="mailboxes">
            <AccordionTrigger className="items-center py-4 hover:no-underline">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-base">Mailboxes</span>
                <span className="text-muted-foreground text-sm font-normal">
                  {free} of {mailboxes.length} free
                </span>
                {shared > 0 ? (
                  <Badge variant="destructive">
                    {shared} shared by several campaigns
                  </Badge>
                ) : null}
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-4 [&_a]:no-underline">
              <Tabs defaultValue="all">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <TabsList>
                    {FILTERS.map((filter) => (
                      <TabsTrigger key={filter.value} value={filter.value}>
                        {filter.label}
                        <span className="text-muted-foreground tabular-nums">
                          {mailboxes.filter(filter.keep).length}
                        </span>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <Hint>
                    A campaign without a mailbox of its own sends from the default one, so it is
                    counted there. Paused campaigns are listed but do not make a mailbox busy.
                  </Hint>
                </div>
                {FILTERS.map((filter) => {
                  const rows = mailboxes.filter(filter.keep)
                  return (
                    <TabsContent key={filter.value} value={filter.value} className="divide-y">
                      {rows.length === 0 ? (
                        <p className="text-muted-foreground py-2">No mailboxes here.</p>
                      ) : (
                        rows.map((mailbox) => <MailboxRow key={mailbox.id} mailbox={mailbox} />)
                      )}
                    </TabsContent>
                  )
                })}
              </Tabs>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}
