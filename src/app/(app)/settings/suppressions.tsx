'use client'

import { useActionState } from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addSuppression, removeSuppression } from '@/lib/actions'

export type SuppressionRow = {
  email: string
  reason: string
  source: string
  created_at: string
}

export function Suppressions({ rows }: { rows: SuppressionRow[] }) {
  const [state, action, pending] = useActionState(addSuppression, {})

  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1 space-y-1">
          <Label htmlFor="block-email" className="flex items-center gap-1.5 text-xs">
            Address or @domain
            <Hint>
              An entry starting with <code>@</code> blocks the whole company, so{' '}
              <code>@example.se</code> stops every address there. Blocking takes the person out
              of every campaign, drops any email already written for them, and keeps them out
              even if a later search finds them again.
            </Hint>
          </Label>
          <Input id="block-email" name="email" placeholder="namn@företag.se" required />
        </div>
        <div className="min-w-40 flex-1 space-y-1">
          <Label htmlFor="block-reason" className="text-xs">
            Reason (optional)
          </Label>
          <Input id="block-reason" name="reason" placeholder="Replied asking to be removed" />
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Spinner /> : null}
          {pending ? 'Blocking…' : 'Block'}
        </Button>
        {state.error ? <p className="text-destructive w-full text-sm">{state.error}</p> : null}
        {state.ok ? (
          <p className="w-full text-sm text-green-600 dark:text-green-400">{state.ok}</p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nobody blocked yet. Unsubscribes from the link in the email footer land here
          automatically.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {rows.map((row) => (
            <li key={row.email} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate font-medium">{row.email}</span>
              <Badge variant={row.source === 'unsubscribe' ? 'default' : 'secondary'}>
                {row.source}
              </Badge>
              {row.reason ? (
                <span className="text-muted-foreground truncate text-xs">{row.reason}</span>
              ) : null}
              <span className="text-muted-foreground text-xs tabular-nums">
                {new Date(row.created_at).toLocaleDateString('sv-SE')}
              </span>
              <ConfirmButton
                action={removeSuppression}
                payload={{ email: row.email }}
                title={`Unblock ${row.email}?`}
                description="They become eligible for campaigns again, and a future search can re-import them. Only do this if they asked to be contacted — an opt-out you reverse yourself is the one a regulator asks about."
                confirmLabel="Unblock"
                pendingLabel="Unblocking…"
              >
                Unblock
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
