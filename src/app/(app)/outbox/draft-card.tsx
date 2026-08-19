'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { approveMessages, discardMessages, sendNow, updateDraft } from '@/lib/actions'
import type { OutboxRow } from './page'

export function DraftCard({ message }: { message: OutboxRow }) {
  const [editing, setEditing] = useState(false)
  const [state, saveAction, saving] = useActionState(updateDraft, {})
  const [busy, setBusy] = useState<string | null>(null)

  async function act(label: string, action: (formData: FormData) => Promise<void>) {
    setBusy(label)
    const formData = new FormData()
    formData.append('messageId', String(message.id))
    try {
      await action(formData)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/leads/${message.lead_id}`} className="font-medium hover:underline">
              {message.lead_name || message.email}
            </Link>
            <div className="text-muted-foreground text-xs">
              {message.email}
              {message.company_name ? ` · ${message.company_name}` : ''} · {message.campaign_name} ·
              step {message.step + 1}
            </div>
          </div>
          <Badge variant={message.status === 'approved' ? 'default' : 'secondary'}>
            {message.status}
          </Badge>
        </div>

        {editing ? (
          <form action={saveAction} className="space-y-2">
            <input type="hidden" name="id" value={message.id} />
            <Input name="subject" defaultValue={message.subject} />
            <Textarea name="body" defaultValue={message.body} rows={10} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Done
              </Button>
              {state.ok ? <span className="self-center text-xs text-green-600">{state.ok}</span> : null}
            </div>
          </form>
        ) : (
          <div className="bg-muted/30 rounded-md border p-3">
            <div className="text-sm font-medium">{message.subject}</div>
            <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">{message.body}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {message.status === 'draft' ? (
            <Button size="sm" disabled={!!busy} onClick={() => act('approve', approveMessages)}>
              {busy === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy}
            onClick={() => act('send', sendNow)}
          >
            {busy === 'send' ? 'Sending…' : 'Send now'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>
            {editing ? 'Close editor' : 'Edit'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive ml-auto"
            disabled={!!busy}
            onClick={() => act('discard', discardMessages)}
          >
            {busy === 'discard' ? 'Discarding…' : 'Discard'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
