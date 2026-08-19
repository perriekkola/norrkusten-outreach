'use client'

import { ChevronRight } from 'lucide-react'
import Link from 'next/link'
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
  regenerateDrafts,
  sendNow,
  sendTestEmail,
  updateDraft,
} from '@/lib/actions'
import { cn } from '@/lib/utils'
import type { OutboxRow } from './page'

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
        and the lead is not marked as contacted.
      </Hint>
      {state.ok ? <span className="text-xs text-green-600 dark:text-green-400">{state.ok}</span> : null}
      {state.error ? <span className="text-destructive text-xs">{state.error}</span> : null}
    </form>
  )
}

function DraftBody({ message }: { message: OutboxRow }) {
  const [editing, setEditing] = useState(false)
  const [state, save, saving] = useActionState(updateDraft, {})

  if (!editing) {
    return (
      <div className="space-y-3">
        <p className="text-sm whitespace-pre-wrap">{message.body}</p>
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
}: {
  messages: OutboxRow[]
  testEmail: string
}) {
  const [selected, setSelected] = useState<number[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)
  const [approving, setApproving] = useState(false)
  const [rewrite, rewriteAction, rewriting] = useActionState(regenerateDrafts, {})

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

        <form action={rewriteAction} className="flex shrink-0 items-center gap-1.5">
          {selected.map((id) => (
            <input key={id} type="hidden" name="messageId" value={id} />
          ))}
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={!selected.length || rewriting}
          >
            {rewriting ? <Spinner /> : null}
            {rewriting ? 'Rewriting…' : 'Rewrite'}
          </Button>
          <Hint>
            Throws these drafts away and writes them again from the campaign&apos;s current
            wording. Changing a guideline or a step goal never touches drafts that already exist,
            so this is how you apply an edit to work already queued. Ten at a time.
          </Hint>
        </form>

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

      {rewrite.ok ? <p className="text-xs text-green-600 dark:text-green-400">{rewrite.ok}</p> : null}
      {rewrite.error ? <p className="text-destructive text-xs">{rewrite.error}</p> : null}

      <Card className="py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selected.length === messages.length && messages.length > 0}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? messages.map((m) => m.id) : [])
                    }
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead className="w-8" />
                <TableHead>Lead</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead className="w-40">Campaign</TableHead>
                <TableHead className="w-16 text-right">Step</TableHead>
                <TableHead className="w-24">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {messages.map((message) => (
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
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{message.step + 1}</TableCell>
                    <TableCell>
                      <Badge variant={message.status === 'approved' ? 'default' : 'secondary'}>
                        {message.status}
                      </Badge>
                    </TableCell>
                  </TableRow>

                  {expanded === message.id ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={7} className="bg-muted/30">
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
                          <DraftBody message={message} />
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
