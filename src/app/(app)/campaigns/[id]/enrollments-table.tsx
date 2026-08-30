'use client'

import Link from 'next/link'
import { ConfirmButton } from '@/components/confirm-button'
import { Pager } from '@/components/pager'
import { SortHeader } from '@/components/sortable'
import type { Sort } from '@/lib/sort'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { markEnrollmentReplied, unenroll } from '@/lib/actions'

export type EnrollmentSortKey =
  | 'lead'
  | 'company'
  | 'score'
  | 'step'
  | 'sent'
  | 'opened'
  | 'status'
  | 'next'

export type EnrollmentRow = {
  id: number
  step: number
  status: string
  next_send_at: string
  score: number | null
  verdict: string | null
  reasons: string | null
  lead_id: number
  full_name: string | null
  email: string
  company_name: string | null
  sent: number
  opened: number
}

const VERDICT_COLOR: Record<string, string> = {
  strong: 'bg-green-500/15 text-green-700 dark:text-green-400',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  weak: 'bg-muted text-muted-foreground',
}

/**
 * The enrolled list, paged and sorted in the database.
 *
 * Both have to happen server-side: a campaign can hold thousands of enrollments, and
 * sorting the hundred rows on this page would show the best score on the page rather than
 * the best score in the campaign — which is exactly the number this table exists to show.
 */
export function EnrollmentsTable({
  rows,
  campaignId,
  minScore,
  stepCount,
  total,
  page,
  perPage,
  sort,
}: {
  rows: EnrollmentRow[]
  campaignId: number
  minScore: number
  stepCount: number
  total: number
  page: number
  perPage: number
  sort: Sort<EnrollmentSortKey> | null
}) {
  const pages = Math.max(1, Math.ceil(total / perPage))

  const url = (next: { page?: number; sort?: Sort<EnrollmentSortKey> | null }) => {
    const target = next.page ?? page
    const order = next.sort === undefined ? sort : next.sort
    const params = new URLSearchParams()
    if (order) {
      params.set('sort', order.key)
      params.set('dir', order.dir)
    }
    if (target > 1) params.set('page', String(target))
    return `/campaigns/${campaignId}${params.size ? `?${params}` : ''}`
  }
  const sortHref = (next: Sort<EnrollmentSortKey> | null) => url({ sort: next, page: 1 })
  const pageHref = (target: number) => url({ page: target })

  return (
    <div className="space-y-4">
      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader label="Lead" sortKey="lead" sort={sort} href={sortHref} />
                <SortHeader label="Company" sortKey="company" sort={sort} href={sortHref} />
                <SortHeader
                  label="Score"
                  sortKey="score"
                  sort={sort}
                  href={sortHref}
                  className="w-24"
                />
                <SortHeader
                  label="Step"
                  sortKey="step"
                  sort={sort}
                  href={sortHref}
                  className="w-20"
                />
                <SortHeader
                  label="Sent"
                  sortKey="sent"
                  sort={sort}
                  href={sortHref}
                  className="w-20"
                />
                <SortHeader
                  label="Opened"
                  sortKey="opened"
                  sort={sort}
                  href={sortHref}
                  className="w-24"
                />
                <SortHeader
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  href={sortHref}
                  className="w-28"
                />
                <SortHeader
                  label="Next"
                  sortKey="next"
                  sort={sort}
                  href={sortHref}
                  className="w-32"
                />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={row.score !== null && row.score < minScore ? 'opacity-45' : ''}
                >
                  <TableCell>
                    <Link href={`/leads/${row.lead_id}`} className="font-medium hover:underline">
                      {row.full_name || row.email}
                    </Link>
                    <div className="text-muted-foreground text-xs">{row.email}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.company_name ?? '—'}
                  </TableCell>
                  <TableCell>
                    {row.score === null ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <span
                        title={row.reasons ?? ''}
                        className={`rounded px-2 py-0.5 text-sm font-medium tabular-nums ${
                          VERDICT_COLOR[row.verdict ?? ''] ?? ''
                        }`}
                      >
                        {row.score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {Math.min(row.step + 1, stepCount)}/{stepCount}
                  </TableCell>
                  <TableCell className="tabular-nums">{row.sent}</TableCell>
                  <TableCell className="tabular-nums">{row.opened}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === 'replied' ? 'default' : 'outline'}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {row.status === 'active'
                      ? new Date(row.next_send_at).toLocaleDateString('sv-SE')
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    {row.status === 'active' ? (
                      <ConfirmButton
                        action={markEnrollmentReplied}
                        payload={{ enrollmentId: row.id }}
                        title="Mark this lead as replied?"
                        description="Ends this campaign's sequence for them and skips any draft still waiting. Other campaigns are not touched — block the address if you want every campaign to stop."
                        confirmLabel="Mark replied"
                        pendingLabel="Saving…"
                      >
                        Mark replied
                      </ConfirmButton>
                    ) : null}
                    <ConfirmButton
                      action={unenroll}
                      payload={{ enrollmentId: row.id }}
                      title="Remove this lead from the campaign?"
                      description="They drop out of this campaign for good, keeping their score and any unsent draft is skipped. The campaign will not pull them back in from its source searches. Enrolling them by hand from the Leads page undoes it."
                      confirmLabel="Remove"
                      pendingLabel="Removing…"
                    >
                      Remove
                    </ConfirmButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Pager page={page} pages={pages} total={total} shown={rows.length} href={pageHref} />
    </div>
  )
}
