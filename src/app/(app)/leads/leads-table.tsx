'use client'

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
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

export function LeadsTable({
  leads,
  campaigns,
}: {
  leads: LeadRow[]
  campaigns: Pick<Campaign, 'id' | 'name'>[]
}) {
  const [selected, setSelected] = useState<number[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const allSelected = selected.length === leads.length && leads.length > 0

  const toggle = (id: number) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )

  /** Every bulk action takes the same `leadId[]` payload. */
  async function run(
    label: string,
    action: (formData: FormData) => Promise<void>,
    extra?: Record<string, string>,
  ) {
    if (!selected.length) return
    setBusy(label)
    const formData = new FormData()
    for (const id of selected) formData.append('leadId', String(id))
    for (const [key, value] of Object.entries(extra ?? {})) formData.set(key, value)
    try {
      await action(formData)
      setSelected([])
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border p-2">
        <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-sm">
          {selected.length ? `${selected.length} selected` : 'Select leads to act on them'}
          <Hint>
            The raw pool of everything scraped. Campaigns normally pull their own leads from the
            searches ticked in their settings, so you rarely need this page — it is for adding a
            hand-picked subset to a campaign that would not otherwise take them.
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
          disabled={!selected.length || !!busy}
          className="ml-auto"
          title={`Block ${selected.length} lead${selected.length === 1 ? '' : 's'}?`}
          description="What to use when someone asks to be taken off the list. Their address goes on the blocked list in Settings: every campaign drops them, pending drafts are skipped, and a future search cannot re-import them. Deleting alone does not do that — the next matching search would bring them straight back."
          confirmLabel="Block"
          pendingLabel="Blocking…"
        >
          Block
        </ConfirmButton>

        <ConfirmButton
          action={deleteLeads}
          payload={{ leadId: selected }}
          disabled={!selected.length || !!busy}
          className="text-destructive"
          title={`Delete ${selected.length} lead${selected.length === 1 ? '' : 's'}?`}
          description="This removes the leads and every enrollment, score and draft attached to them. Sent emails stay in the record. It cannot be undone — re-running the search would re-import them as new."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
        >
          Delete
        </ConfirmButton>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? leads.map((lead) => lead.id) : [])
                    }
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead className="w-28">Outreach</TableHead>
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
    </div>
  )
}
