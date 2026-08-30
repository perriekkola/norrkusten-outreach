'use client'

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import { Pager } from '@/components/pager'
import { SortHeader } from '@/components/sortable'
import type { Sort } from '@/lib/sort'
import { ConfirmButton } from '@/components/confirm-button'
import { Spinner } from '@/components/spinner'
import { Hint } from '@/components/hint'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { blockLeads, deleteLeads, enrollLeads } from '@/lib/actions'
import type { Campaign } from '@/lib/db'
import type { LeadRow } from './page'

const count = (n: number) => n.toLocaleString('sv-SE')

type LeadSortKey = 'name' | 'company' | 'title' | 'outreach'

export function LeadsTable({
  leads,
  campaigns,
  total,
  page,
  perPage,
  filter,
  sort,
}: {
  leads: LeadRow[]
  campaigns: Pick<Campaign, 'id' | 'name'>[]
  total: number
  page: number
  perPage: number
  filter: { query: string; source: number | null }
  sort: Sort<LeadSortKey> | null
}) {
  const [selected, setSelected] = useState<number[]>([])
  /** Enrol every row the filter matches, not just the page. Off unless asked for. */
  const [allMatching, setAllMatching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const allSelected = selected.length === leads.length && leads.length > 0
  const pages = Math.max(1, Math.ceil(total / perPage))

  function select(ids: number[]) {
    setSelected(ids)
    setAllMatching(false)
  }

  const toggle = (id: number) =>
    select(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])

  /** Filters, sort and page travel together — changing one must not silently drop another. */
  const url = (next: { page?: number; sort?: Sort<LeadSortKey> | null }) => {
    const target = next.page ?? page
    const order = next.sort === undefined ? sort : next.sort
    const params = new URLSearchParams()
    if (filter.query) params.set('q', filter.query)
    if (filter.source) params.set('source', String(filter.source))
    if (order) {
      params.set('sort', order.key)
      params.set('dir', order.dir)
    }
    if (target > 1) params.set('page', String(target))
    return `/leads${params.size ? `?${params}` : ''}`
  }
  // A different order means a different first page.
  const sortHref = (next: Sort<LeadSortKey> | null) => url({ sort: next, page: 1 })
  const pageHref = (target: number) => url({ page: target })

  /** Every bulk action takes the same `leadId[]` payload — except enrolling everything
   *  matching, which sends the filter and lets the database pick the rows. */
  async function run(
    label: string,
    action: (formData: FormData) => Promise<void>,
    extra?: Record<string, string>,
  ) {
    if (!selected.length) return
    setBusy(label)
    const formData = new FormData()
    if (allMatching) {
      formData.set('allMatching', '1')
      formData.set('q', filter.query)
      if (filter.source) formData.set('source', String(filter.source))
    } else {
      for (const id of selected) formData.append('leadId', String(id))
    }
    for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value)
    try {
      await action(formData)
      select([])
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border p-2">
        <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-sm">
          {allMatching
            ? `All ${count(total)} matching selected`
            : selected.length
              ? `${count(selected.length)} selected`
              : 'Select leads to act on them'}
          <Hint>
            Everything the searches have found. Campaigns normally take their own leads from
            the searches ticked in their settings. Use this page to hand-pick people for a
            campaign that would not otherwise reach them.
          </Hint>
        </span>
        {/* Action menus, not form inputs — a <select> that fires on change is the wrong control. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected.length || !!busy || campaigns.length === 0}
            >
              {busy === 'enroll' ? <Spinner /> : null}
              {busy === 'enroll' ? 'Adding…' : 'Add to campaign'}
              <ChevronDown className="ml-1 size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {campaigns.map((campaign) => (
              <DropdownMenuItem
                key={campaign.id}
                onSelect={() => run('enroll', enrollLeads, { campaignId: String(campaign.id) })}
              >
                {campaign.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ConfirmButton
          action={blockLeads}
          payload={{ leadId: selected }}
          disabled={!selected.length || !!busy || allMatching}
          className="ml-auto"
          title={`Block ${count(selected.length)} lead${selected.length === 1 ? '' : 's'}?`}
          description="What to use when someone asks to be taken off the list. Their address goes on the blocked list in Settings: every campaign drops them, pending drafts are skipped, and a future search cannot re-import them. Deleting alone does not do that — the next matching search would bring them straight back."
          confirmLabel="Block"
          pendingLabel="Blocking…"
        >
          Block
        </ConfirmButton>

        <ConfirmButton
          action={deleteLeads}
          payload={{ leadId: selected }}
          disabled={!selected.length || !!busy || allMatching}
          className="text-destructive"
          title={`Delete ${count(selected.length)} lead${selected.length === 1 ? '' : 's'}?`}
          description="This removes the leads and every enrollment, score and draft attached to them. Sent emails stay in the record. It cannot be undone — re-running the search would re-import them as new."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
        >
          Delete
        </ConfirmButton>
      </div>

      {/* The whole point of the filter: enrol a 975-lead search without paging through it. */}
      {allSelected && total > leads.length ? (
        <p className="text-muted-foreground px-2 text-xs">
          {allMatching ? (
            <>
              All {count(total)} leads matching this filter will be enrolled. Blocking and
              deleting still act on ticked rows only.{' '}
              <button
                type="button"
                onClick={() => setAllMatching(false)}
                className="text-primary underline"
              >
                Just this page
              </button>
            </>
          ) : (
            <>
              All {count(leads.length)} on this page are selected.{' '}
              <button
                type="button"
                onClick={() => setAllMatching(true)}
                className="text-primary underline"
              >
                Select all {count(total)} matching this filter
              </button>
            </>
          )}
        </p>
      ) : null}

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      select(checked ? leads.map((lead) => lead.id) : [])
                    }
                  />
                </TableHead>
                <SortHeader label="Name" sortKey="name" sort={sort} href={sortHref} />
                <SortHeader label="Company" sortKey="company" sort={sort} href={sortHref} />
                <SortHeader
                  label="Outreach"
                  sortKey="outreach"
                  sort={sort}
                  href={sortHref}
                  className="w-28"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => (
                <TableRow key={lead.id} data-state={selected.includes(lead.id) && 'selected'}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                      {lead.full_name || lead.email}
                    </Link>
                    <div className="text-muted-foreground text-xs">
                      {lead.job_title ?? '—'} · {lead.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>{lead.company_name ?? '—'}</div>
                    <div className="text-muted-foreground text-xs">
                      {[lead.industry, lead.company_size].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {lead.replied ? (
                      <Badge>Replied</Badge>
                    ) : lead.contacted ? (
                      <Badge variant="secondary">Contacted</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Not contacted
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pager page={page} pages={pages} total={total} shown={leads.length} href={pageHref} />
    </div>
  )
}
