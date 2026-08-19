'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  deleteLeads,
  enrollLeads,
  qualifyLeads,
  researchLeads,
  setLeadStatus,
} from '@/lib/actions'
import type { Campaign, Lead } from '@/lib/db'

const VERDICT_COLOR: Record<string, string> = {
  strong: 'bg-green-500/15 text-green-700 dark:text-green-400',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  weak: 'bg-muted text-muted-foreground',
}

export function LeadsTable({
  leads,
  campaigns,
}: {
  leads: Lead[]
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
        <span className="text-muted-foreground px-2 text-sm">
          {selected.length ? `${selected.length} selected` : 'Select leads to act on them'}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected.length || !!busy}
          onClick={() => run('qualify', qualifyLeads)}
        >
          {busy === 'qualify' ? 'Qualifying…' : 'Qualify with AI'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected.length || !!busy}
          onClick={() => run('research', researchLeads)}
        >
          {busy === 'research' ? 'Researching…' : 'Research company'}
        </Button>
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          defaultValue=""
          disabled={!selected.length || !!busy || campaigns.length === 0}
          onChange={(event) => {
            const campaignId = event.target.value
            event.target.value = ''
            if (campaignId) run('enroll', enrollLeads, { campaignId })
          }}
        >
          <option value="">
            {campaigns.length ? 'Enroll in campaign…' : 'No active campaigns'}
          </option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          defaultValue=""
          disabled={!selected.length || !!busy}
          onChange={(event) => {
            const status = event.target.value
            event.target.value = ''
            if (status) run('status', setLeadStatus, { status })
          }}
        >
          <option value="">Set status…</option>
          {['qualified', 'rejected', 'contacted', 'replied', 'won', 'lost'].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive ml-auto"
          disabled={!selected.length || !!busy}
          onClick={() => {
            if (confirm(`Delete ${selected.length} lead(s)?`)) run('delete', deleteLeads)
          }}
        >
          Delete
        </Button>
      </div>

      <p className="text-muted-foreground -mt-2 px-2 text-xs">
        AI actions process up to 40 leads (qualify) or 15 leads (research) per click, so the request
        finishes inside the function timeout. Run again for the rest.
      </p>

      <Card>
        <CardContent className="px-0">
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
                <TableHead className="w-20 text-right">Score</TableHead>
                <TableHead className="w-24">Status</TableHead>
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
                  <TableCell className="text-right">
                    {lead.score === null ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <span
                        className={`rounded px-2 py-0.5 text-sm font-medium tabular-nums ${
                          VERDICT_COLOR[lead.verdict ?? ''] ?? ''
                        }`}
                      >
                        {lead.score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {lead.status}
                    </Badge>
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
