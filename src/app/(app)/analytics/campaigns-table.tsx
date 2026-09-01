'use client'

import { useState } from 'react'
import { SortHeader } from '@/components/sortable'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { sortRows, type Sort } from '@/lib/sort'
import type { CampaignRow } from './page'

type SortKey = 'name' | 'enrolled' | 'sent' | 'opened' | 'replied'

const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—'

/** Rates, not counts, for the two columns that show both: 3 opens of 4 beats 30 of 900. */
const sortValue = (row: CampaignRow, key: SortKey): string | number =>
  key === 'name'
    ? row.name
    : key === 'opened' || key === 'replied'
      ? row.sent > 0
        ? row[key] / row.sent
        : -1
      : row[key]

/** Every campaign is already on the page, so sorting happens here rather than in the URL. */
export function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const [sort, setSort] = useState<Sort<SortKey> | null>(null)
  const rows = sortRows(campaigns, sort, sortValue)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader label="Campaign" sortKey="name" sort={sort} onSort={setSort} />
          <SortHeader
            label="Enrolled"
            sortKey="enrolled"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortHeader
            label="Sent"
            sortKey="sent"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortHeader
            label="Opened"
            sortKey="opened"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortHeader
            label="Replied"
            sortKey="replied"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-medium">{row.name}</TableCell>
            <TableCell className="text-right tabular-nums">{row.enrolled}</TableCell>
            <TableCell className="text-right tabular-nums">{row.sent}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.opened}{' '}
              <span className="text-muted-foreground text-xs">
                {percent(row.opened, row.sent)}
              </span>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.replied}{' '}
              <span className="text-muted-foreground text-xs">
                {percent(row.replied, row.sent)}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
