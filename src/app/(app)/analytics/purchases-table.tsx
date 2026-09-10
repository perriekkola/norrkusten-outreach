'use client'

import Link from 'next/link'
import { useState } from 'react'
import { SortHeader } from '@/components/sortable'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { money } from '@/lib/format'
import { sortRows, type Sort } from '@/lib/sort'
import type { PurchaseRow } from './page'

type SortKey = 'domain' | 'course' | 'amount' | 'purchased' | 'days' | 'campaign'

const sortValue = (row: PurchaseRow, key: SortKey): string | number =>
  key === 'domain'
    ? row.domain
    : key === 'course'
      ? (row.course_title ?? '')
      : key === 'campaign'
        ? row.campaign_name
        : key === 'amount'
          ? Number(row.total_excl_vat ?? 0)
          : key === 'days'
            ? row.days_after
            : row.purchased_at

/** Why the purchase is on this row, spelled out — two of the three are inferences. */
const WHY = {
  email: 'The address we mailed is on the purchase.',
  domain: 'A colleague on the same email domain bought.',
  company: 'Same company name, different email domain.',
} as const

export function PurchasesTable({ purchases }: { purchases: PurchaseRow[] }) {
  const [sort, setSort] = useState<Sort<SortKey> | null>(null)
  const rows = sortRows(purchases, sort, sortValue)

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortHeader label="Domain" sortKey="domain" sort={sort} onSort={setSort} />
          <SortHeader label="Course" sortKey="course" sort={sort} onSort={setSort} />
          <SortHeader label="Campaign" sortKey="campaign" sort={sort} onSort={setSort} />
          <SortHeader
            label="Bought"
            sortKey="purchased"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortHeader
            label="After"
            sortKey="days"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
          <SortHeader
            label="Amount"
            sortKey="amount"
            sort={sort}
            onSort={setSort}
            className="text-right"
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.purchase_id}>
            <TableCell>
              <div className="font-medium">{row.domain}</div>
              <div className="text-muted-foreground text-xs">
                {row.org_name ?? '—'} ·{' '}
                <Link href={`/leads/${row.lead_id}`} className="hover:underline">
                  {row.lead_email}
                </Link>
              </div>
            </TableCell>
            <TableCell>
              <div className="max-w-[22rem] truncate">
                {row.course_title || row.course_code || '—'}
              </div>
              <div className="text-muted-foreground text-xs">
                <Badge variant={row.matched_on === 'email' ? 'default' : 'secondary'}>
                  {row.matched_on} match
                </Badge>{' '}
                {WHY[row.matched_on]}
              </div>
            </TableCell>
            <TableCell>
              <Link href={`/campaigns/${row.campaign_id}`} className="hover:underline">
                {row.campaign_name}
              </Link>
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {new Date(row.purchased_at).toLocaleDateString('sv-SE')}
            </TableCell>
            <TableCell className="text-muted-foreground text-right tabular-nums">
              {row.days_after}d
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.total_excl_vat ? money(Number(row.total_excl_vat), row.currency) : '—'}
              {row.quantity > 1 ? (
                <div className="text-muted-foreground text-xs">{row.quantity} licenses</div>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
