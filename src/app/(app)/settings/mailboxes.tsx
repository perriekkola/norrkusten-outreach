'use client'

import { useActionState, useState } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { deleteMailbox, saveMailbox, testMailbox } from '@/lib/actions'

/** Never includes smtp_pass — the encrypted value has no business reaching the browser. */
export type MailboxRow = {
  id: number
  name: string
  from_email: string
  reply_to: string | null
  smtp_host: string
  smtp_port: number
  smtp_user: string
  signature: string
  imap_host: string | null
  imap_port: number
  is_default: boolean
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

function MailboxForm({ mailbox, onDone }: { mailbox?: MailboxRow; onDone: () => void }) {
  const [state, action, pending] = useActionState(saveMailbox, {})

  return (
    <form action={action} className="space-y-3 rounded-lg border p-4">
      {mailbox ? <input type="hidden" name="id" value={mailbox.id} /> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Label">
          <Input name="name" defaultValue={mailbox?.name} placeholder="Rickard" required />
        </Field>
        <Field label="From">
          <Input
            name="from_email"
            defaultValue={mailbox?.from_email}
            placeholder="Rickard Riekkola <rickard@norrkusten.se>"
            required
          />
        </Field>
        <Field label="SMTP host">
          <Input name="smtp_host" defaultValue={mailbox?.smtp_host ?? 'send.one.com'} required />
        </Field>
        <Field label="SMTP port">
          <Input name="smtp_port" type="number" defaultValue={mailbox?.smtp_port ?? 465} />
        </Field>
        <Field label="Username">
          <Input
            name="smtp_user"
            defaultValue={mailbox?.smtp_user}
            placeholder="rickard@norrkusten.se"
            required
          />
        </Field>
        <Field label={mailbox ? 'Password (leave blank to keep)' : 'Password'}>
          <Input name="smtp_pass" type="password" autoComplete="new-password" />
        </Field>
        <Field label="IMAP host (for reply detection)">
          <Input name="imap_host" defaultValue={mailbox?.imap_host ?? 'imap.one.com'} />
        </Field>
        <Field label="IMAP port">
          <Input name="imap_port" type="number" defaultValue={mailbox?.imap_port ?? 993} />
        </Field>
        <Field label="Reply-To (optional)">
          <Input name="reply_to" defaultValue={mailbox?.reply_to ?? ''} />
        </Field>
      </div>

      <div className="space-y-1">
        <Label className="flex items-center gap-1.5 text-xs">
          Signature
          <Hint>
            Appended to every email sent from this mailbox. Claude is told not to write a
            sign-off, so this is the only place a name and closing appear — keep it short, since
            a long block reads as marketing in a cold email.
          </Hint>
        </Label>
        <Textarea
          name="signature"
          rows={4}
          defaultValue={mailbox?.signature}
          placeholder={'Vänliga hälsningar\nRickard Riekkola\nNorrkusten Utbildning\n0920-19100'}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="is_default" defaultChecked={mailbox?.is_default} />
        Use for campaigns that have not picked a mailbox
      </label>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Spinner /> : null}
          {pending ? 'Saving…' : mailbox ? 'Save' : 'Add mailbox'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </form>
  )
}

function TestButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(testMailbox, {})
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Testing…' : 'Test'}
      </Button>
      {state.ok ? <span className="text-xs text-green-600 dark:text-green-400">{state.ok}</span> : null}
      {state.error ? <span className="text-destructive text-xs">{state.error}</span> : null}
    </form>
  )
}

export function Mailboxes({ mailboxes }: { mailboxes: MailboxRow[] }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  return (
    <div className="space-y-4">
      {mailboxes.length === 0 && editing !== 'new' ? (
        <p className="text-muted-foreground text-sm">
          None yet. Until one exists, sending falls back to the SMTP environment variables.
        </p>
      ) : null}

      {mailboxes.map((mailbox) =>
        editing === mailbox.id ? (
          <MailboxForm key={mailbox.id} mailbox={mailbox} onDone={() => setEditing(null)} />
        ) : (
          <div key={mailbox.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {mailbox.name}
                {mailbox.is_default ? <Badge variant="secondary">default</Badge> : null}
                {!mailbox.imap_host ? (
                  <Badge variant="outline" className="text-muted-foreground">
                    no reply detection
                  </Badge>
                ) : null}
              </div>
              <div className="text-muted-foreground truncate text-xs">
                {mailbox.from_email} · {mailbox.smtp_host}:{mailbox.smtp_port}
              </div>
            </div>
            <TestButton id={mailbox.id} />
            <Button size="sm" variant="ghost" onClick={() => setEditing(mailbox.id)}>
              Edit
            </Button>
            <ConfirmButton
              action={deleteMailbox}
              payload={{ id: mailbox.id }}
              className="text-destructive"
              title={`Delete "${mailbox.name}"?`}
              description="Campaigns using it fall back to the default mailbox. Emails already sent are unaffected, but replies to them stop being detected unless another mailbox polls the same inbox."
              confirmLabel="Delete"
              pendingLabel="Deleting…"
            >
              Delete
            </ConfirmButton>
          </div>
        ),
      )}

      {editing === 'new' ? (
        <MailboxForm onDone={() => setEditing(null)} />
      ) : (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            Add mailbox
          </Button>
          <Hint>
            Each campaign picks which mailbox sends it, so outreach can come from whoever owns the
            relationship. Passwords are encrypted with a key derived from AUTH_SECRET — changing
            that variable means re-entering every password here.
          </Hint>
        </div>
      )}
    </div>
  )
}
