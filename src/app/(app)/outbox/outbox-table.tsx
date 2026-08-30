'use client'

import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Fragment, useActionState, useState } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  approveMessages,
  discardMessages,
  sendNow,
  sendTestEmail,
  updateDraft,
} from '@/lib/actions'
import type { RewritePass } from '@/lib/engine'
import { formatDetail, readProgress, type Progress } from '@/lib/stream'
import { cn } from '@/lib/utils'
import type { OutboxRow } from './page'

/**
 * Fixed time zone on purpose. This table renders on the server and hydrates in the
 * browser, and Vercel runs in UTC — formatting in "local" time would print 14:27 on the
 * server and 16:27 in Stockholm, which React reports as a hydration mismatch.
 */
const WRITTEN_AT = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Stockholm',
})

type SortKey = 'lead' | 'subject' | 'campaign' | 'step' | 'status' | 'written'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const sortValue = (message: OutboxRow, key: SortKey): string | number => {
  switch (key) {
    case 'lead':
      return message.lead_name || message.email
    case 'subject':
      return message.subject
    case 'campaign':
      return message.campaign_name
    case 'step':
      return message.step
    case 'status':
      return message.auto_send ? 'auto-send' : message.status
    case 'written':
      return Date.parse(message.created_at) || 0
  }
}

/** Third click clears the sort — the unsorted order is the order these actually go out. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string
  sortKey: SortKey
  sort: Sort | null
  onSort: (next: Sort | null) => void
  className?: string
}) {
  const active = sort?.key === sortKey
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        className="hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap"
        onClick={() =>
          onSort(
            !active
              ? { key: sortKey, dir: 'asc' }
              : sort.dir === 'asc'
                ? { key: sortKey, dir: 'desc' }
                : null,
          )
        }
      >
        {label}
        <Icon className={cn('size-3', active ? 'opacity-80' : 'opacity-30')} />
      </button>
    </TableHead>
  )
}

function TestSend({ message, defaultTo }: { message: OutboxRow; defaultTo: string }) {
  const [state, action, pending] = useActionState(sendTestEmail, {})

  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-t pt-3">
      <input type="hidden" name="id" value={message.id} />
      <Input
        name="to"
        type="email"
        defaultValue={defaultTo}
        placeholder="you@norrkusten.se"
        className="w-56"
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Sending…' : 'Send test'}
      </Button>
      <Hint>
        Sends this exact draft to an address of your choosing, subject prefixed with [TEST], from
        the campaign&apos;s mailbox. Untracked and not recorded — no pixel, no rewritten links,
        and the lead is not marked as contacted. The unsubscribe line at the bottom is real,
        though, so you can see what goes out: following it asks you to confirm before it blocks
        anyone, and the address it names is the lead&apos;s, not yours.
      </Hint>
      {state.ok ? <span className="text-xs text-green-600 dark:text-green-400">{state.ok}</span> : null}
      {state.error ? <span className="text-destructive text-xs">{state.error}</span> : null}
    </form>
  )
}

function DraftBody({ message, signature }: { message: OutboxRow; signature: string }) {
  const [editing, setEditing] = useState(false)
  const [state, save, saving] = useActionState(updateDraft, {})

  if (!editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm whitespace-pre-wrap">{message.body}</p>
        {signature ? (
          <p className="text-muted-foreground border-l-2 pl-3 text-sm whitespace-pre-wrap">
            {signature}
          </p>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    )
  }

  return (
    <form action={save} className="space-y-2">
      <input type="hidden" name="id" value={message.id} />
      <Input name="subject" defaultValue={message.subject} />
      <Textarea name="body" defaultValue={message.body} rows={12} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Spinner /> : null}
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Done
        </Button>
        {state.ok ? <span className="text-xs text-green-600 dark:text-green-400">{state.ok}</span> : null}
      </div>
    </form>
  )
}

export function OutboxTable({
  messages,
  testEmail,
  signatureFor,
}: {
  messages: OutboxRow[]
  testEmail: string
  /** Shown after the body so the preview matches what is actually delivered. */
  signatureFor: Record<number, string>
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<number[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [approving, setApproving] = useState(false)
  const [sort, setSort] = useState<Sort | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [rewriteResult, setRewriteResult] = useState<string | null>(null)
  const rewriting = progress !== null

  const rows = sort
    ? [...messages].sort((a, b) => {
        const left = sortValue(a, sort.key)
        const right = sortValue(b, sort.key)
        const order =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), 'sv')
        return sort.dir === 'asc' ? order : -order
      })
    : messages

  /**
   * Rewrite everything selected, however many that is.
   *
   * One request can only fit what the function timeout allows, so the server hands back
   * whatever it did not reach and this asks again for exactly those. A pass that rewrites
   * nothing ends the loop — otherwise a draft that fails every single time would spin here
   * for ever.
   */
  async function rewriteSelected() {
    setRewriteResult(null)
    setProgress({ phase: 'Starting' })
    let rewritten = 0
    let failed = 0
    let reason = ''
    let stuck = 0
    try {
      let body: { messageIds?: number[]; enrollmentIds?: number[] } = { messageIds: selected }
      for (;;) {
        const pass = await readProgress<RewritePass>('/api/outbox/rewrite', body, setProgress)
        rewritten += pass.rewritten
        failed += pass.failed
        reason ||= pass.reason
        if (!pass.pending.length) break
        if (pass.rewritten === 0) {
          stuck = pass.pending.length
          break
        }
        body = { enrollmentIds: pass.pending }
      }
      setSelected([])
      setRewriteResult(
        [
          `Rewrote ${rewritten}`,
          failed ? `${failed} failed${reason ? `: ${reason}` : ''}` : null,
          stuck && !failed ? `${stuck} could not be written` : null,
        ]
          .filter(Boolean)
          .join('. '),
      )
      router.refresh()
    } catch (error) {
      setRewriteResult(error instanceof Error ? error.message : String(error))
    } finally {
      setProgress(null)
    }
  }

  const toggle = (id: number) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    )

  async function approve() {
    setApproving(true)
    const formData = new FormData()
    for (const id of selected) formData.append('messageId', String(id))
    try {
      await approveMessages(formData)
      setSelected([])
    } finally {
      setApproving(false)
    }
  }

  const draftsSelected = selected.filter(
    (id) => messages.find((m) => m.id === id)?.status === 'draft',
  )

  return (
    <div className="space-y-4">
      <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-lg border p-2">
        <span className="text-muted-foreground flex items-center gap-1.5 px-2 text-sm">
          {selected.length ? `${selected.length} selected` : 'Select drafts to act on them'}
          <Hint>
            Click a row to read the email. Approve queues it for the next cron run; Send now
            delivers immediately. Nothing leaves until you do one of those.
          </Hint>
        </span>

        <Button size="sm" disabled={!draftsSelected.length || approving} onClick={approve}>
          {approving ? <Spinner /> : null}
          {approving ? 'Approving…' : `Approve${draftsSelected.length ? ` ${draftsSelected.length}` : ''}`}
        </Button>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={rewriteSelected}
            disabled={!selected.length || rewriting}
          >
            {rewriting ? <Spinner /> : null}
            {rewriting ? 'Rewriting…' : `Rewrite${selected.length ? ` ${selected.length}` : ''}`}
          </Button>
          <Hint>
            Throws these drafts away and writes them again from the campaign&apos;s current
            wording. Changing a guideline or a step goal never touches drafts that already exist,
            so this is how you apply an edit to work already queued. It works through the whole
            selection, continuing by itself if that takes more than one pass — the Written
            column shows which have been redone.
          </Hint>
        </div>

        <ConfirmButton
          action={sendNow}
          payload={{ messageId: selected }}
          variant="outline"
          disabled={!selected.length}
          title={`Send ${selected.length} email${selected.length === 1 ? '' : 's'} now?`}
          description="These are delivered immediately to real people. Email cannot be recalled."
          confirmLabel="Send"
          pendingLabel="Sending…"
        >
          Send now
        </ConfirmButton>

        <ConfirmButton
          action={discardMessages}
          payload={{ messageId: selected }}
          className="text-destructive ml-auto"
          disabled={!selected.length}
          title={`Discard ${selected.length} draft${selected.length === 1 ? '' : 's'}?`}
          description="The drafts are dropped and those steps are skipped. Each sequence carries on to its next step at the scheduled time."
          confirmLabel="Discard"
          pendingLabel="Discarding…"
        >
          Discard
        </ConfirmButton>
      </div>

      {rewriting ? (
        <p className="text-muted-foreground truncate text-xs">
          {progress.phase}
          {progress.detail ? ` · ${formatDetail(progress.detail)}` : ''}
        </p>
      ) : null}
      {rewriteResult && !rewriting ? (
        <p className="text-muted-foreground text-xs">{rewriteResult}</p>
      ) : null}
      {sort ? (
        <p className="text-muted-foreground text-xs">
          Sorted by {sort.key}.{' '}
          <button type="button" onClick={() => setSort(null)} className="text-primary underline">
            Back to send order
          </button>
        </p>
      ) : null}

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.length === rows.length && rows.length > 0}
                    onCheckedChange={(checked) => setSelected(checked ? rows.map((m) => m.id) : [])}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-8" />
                <SortHeader label="Lead" sortKey="lead" sort={sort} onSort={setSort} />
                <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={setSort} />
                <SortHeader
                  label="Campaign"
                  sortKey="campaign"
                  sort={sort}
                  onSort={setSort}
                  className="w-40"
                />
                <SortHeader
                  label="Step"
                  sortKey="step"
                  sort={sort}
                  onSort={setSort}
                  className="w-16"
                />
                <SortHeader
                  label="Written"
                  sortKey="written"
                  sort={sort}
                  onSort={setSort}
                  className="w-32"
                />
                <SortHeader
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onSort={setSort}
                  className="w-24"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((message) => (
                // Keyed Fragment, not <>: the key has to sit on what map returns, or React
                // remounts both rows on every change instead of reconciling them.
                <Fragment key={message.id}>
                  <TableRow
                    data-state={selected.includes(message.id) && 'selected'}
                    className="cursor-pointer"
                    onClick={() => setExpanded(expanded === message.id ? null : message.id)}
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={selected.includes(message.id)}
                        onCheckedChange={() => toggle(message.id)}
                        aria-label={`Select email to ${message.email}`}
                      />
                    </TableCell>
                    <TableCell>
                      <ChevronRight
                        className={cn(
                          'text-muted-foreground size-4 transition-transform',
                          expanded === message.id && 'rotate-90',
                        )}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{message.lead_name || message.email}</div>
                      <div className="text-muted-foreground text-xs">
                        {message.company_name ?? message.email}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[320px] truncate">{message.subject}</TableCell>
                    <TableCell className="text-muted-foreground truncate text-xs">
                      {message.campaign_name}
                      {message.auto_send ? (
                        <div className="mt-0.5 font-medium text-amber-600 dark:text-amber-500">
                          auto-send
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{message.step + 1}</TableCell>
                    <TableCell className="text-muted-foreground text-xs tabular-nums">
                      {WRITTEN_AT.format(new Date(message.created_at))}
                    </TableCell>
                    <TableCell>
                      {/* Auto-send drafts are inserted already approved, so the plain
                          "approved" badge reads as something a person did. It wasn't. */}
                      <Badge
                        variant={message.status === 'approved' ? 'default' : 'secondary'}
                        className={
                          message.auto_send
                            ? 'border-transparent bg-amber-500 text-white hover:bg-amber-500'
                            : undefined
                        }
                      >
                        {message.auto_send ? 'goes out automatically' : message.status}
                      </Badge>
                    </TableCell>
                  </TableRow>

                  {expanded === message.id ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={8} className="bg-muted/30">
                        <div className="max-w-3xl space-y-3 py-2">
                          <div className="text-sm">
                            <Link
                              href={`/leads/${message.lead_id}`}
                              className="text-muted-foreground text-xs hover:underline"
                            >
                              {message.email} →
                            </Link>
                            <div className="mt-1 font-medium">{message.subject}</div>
                          </div>
                          <DraftBody
                            message={message}
                            signature={signatureFor[message.campaign_id] ?? ''}
                          />
                          <TestSend message={message} defaultTo={testEmail} />
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
    </div>
  )
}
