'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type Run = {
  id: number
  started_at: string
  finished_at: string | null
  ok: boolean | null
  result: Record<string, number | boolean | string> | null
  error: string | null
}

const AT = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
})

const seconds = (run: Run) =>
  run.finished_at
    ? Math.round((Date.parse(run.finished_at) - Date.parse(run.started_at)) / 1000)
    : null

/** The counts worth seeing at a glance, in the order a round does them. */
const COLUMNS = [
  { key: 'replies', label: 'Replies' },
  { key: 'bounced', label: 'Bounced' },
  { key: 'optedOut', label: 'Opt-outs' },
  { key: 'sent', label: 'Sent' },
  { key: 'drafted', label: 'Written' },
  { key: 'held', label: 'Held' },
] as const

export function RunsTable({ runs }: { runs: Run[] }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // The whole lot as JSON, because the reason a round went wrong is usually in a
            // field this table does not have a column for, and pasting beats screenshots.
            void navigator.clipboard?.writeText(JSON.stringify(runs, null, 2)).catch(() => {})
            setCopied(true)
          }}
        >
          {copied ? 'Copied' : `Copy last ${runs.length} as JSON`}
        </Button>
        <span className="text-muted-foreground text-xs">
          For pasting somewhere when something needs looking at.
        </span>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Started</TableHead>
                <TableHead className="w-20">Took</TableHead>
                {COLUMNS.map((column) => (
                  <TableHead key={column.key} className="w-20">
                    {column.label}
                  </TableHead>
                ))}
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => {
                const took = seconds(run)
                return (
                  <TableRow key={run.id} className={run.ok === false ? 'bg-destructive/5' : ''}>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {AT.format(new Date(run.started_at))}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {took === null ? 'running' : `${took}s`}
                    </TableCell>
                    {COLUMNS.map((column) => {
                      const value = Number(run.result?.[column.key] ?? 0)
                      return (
                        <TableCell
                          key={column.key}
                          className={`tabular-nums ${value ? '' : 'text-muted-foreground/40'}`}
                        >
                          {value}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-xs">
                      {run.ok === false ? (
                        <span className="text-destructive">{run.error ?? 'failed'}</span>
                      ) : run.result?.throttled ? (
                        <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 dark:text-amber-400">
                          mail server asked us to slow down
                        </Badge>
                      ) : took === null ? (
                        <span className="text-muted-foreground">still going</span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          No rounds recorded yet. One is due within the half hour.
        </p>
      ) : null}
    </div>
  )
}
