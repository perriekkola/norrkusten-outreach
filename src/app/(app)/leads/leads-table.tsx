'use client'

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
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
import { deleteLeads, enrollLeads, researchLeads, setLeadStatus } from '@/lib/actions'
import type { Campaign, Lead } from '@/lib/db'

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
          onClick={() => run('research', researchLeads)}
        >
          {busy === 'research' ? 'Researching…' : 'Research company'}
        </Button>
        {/* Action menus, not form inputs — a <select> that fires on change is the wrong control. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={!selected.length || !!busy || campaigns.length === 0}
            >
              {busy === 'enroll' ? 'Enrolling…' : 'Enroll in campaign'}
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={!selected.length || !!busy}>
              {busy === 'status' ? 'Updating…' : 'Set status'}
              <ChevronDown className="ml-1 size-3.5 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {['new', 'contacted', 'replied', 'won', 'lost', 'rejected'].map((status) => (
              <DropdownMenuItem
                key={status}
                className="capitalize"
                onSelect={() => run('status', setLeadStatus, { status })}
              >
                {status}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

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
        Research runs on up to 15 leads per click so the request finishes inside the function
        timeout. Scoring happens inside a campaign, against that campaign&apos;s own profile.
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
                <TableHead className="w-24">Researched</TableHead>
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
                  <TableCell>
                    {lead.research ? (
                      <Badge variant="secondary">yes</Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
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
