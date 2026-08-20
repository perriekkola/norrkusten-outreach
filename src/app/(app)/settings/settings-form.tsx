'use client'

import { useActionState } from 'react'
import { Hint } from '@/components/hint'
import { PasswordInput } from '@/components/password-input'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addUser, saveSendingLimits, saveSettings } from '@/lib/actions'

export function SettingsForm({ senderName }: { senderName: string }) {
  const [state, action, pending] = useActionState(saveSettings, {})

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="sender_name">Default sender name</Label>
        <Input id="sender_name" name="sender_name" defaultValue={senderName} />
      </div>
      {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

export function SendingLimitsForm({ cap, cooldown }: { cap: number; cooldown: number }) {
  const [state, action, pending] = useActionState(saveSendingLimits, {})

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="daily_send_cap" className="flex items-center gap-1.5">
            Emails per mailbox per day
            <Hint>
              Counted over a rolling 24 hours, per sending mailbox, and the cron takes half of
              it per run. 30–50 is the band a warmed domain can hold; most senders sit at 40.
              Above 50 the risk of domain-level reputation damage climbs sharply, so this field
              refuses to go higher. Need more volume? Add mailboxes rather than raising this.
            </Hint>
          </Label>
          <Input
            id="daily_send_cap"
            name="daily_send_cap"
            type="number"
            min={1}
            max={50}
            defaultValue={cap}
          />
          <p className="text-muted-foreground text-xs">
            {Math.ceil(cap / 2)} per cron run, twice a day.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lead_cooldown_days" className="flex items-center gap-1.5">
            Days between emails to one person
            <Hint>
              Applies across every campaign, not per campaign. Without it, five campaigns
              pulling from overlapping searches will each email the same person — who sees one
              sender mailing them five times. Send now overrides this; the cron does not.
            </Hint>
          </Label>
          <Input
            id="lead_cooldown_days"
            name="lead_cooldown_days"
            type="number"
            min={0}
            max={30}
            defaultValue={cooldown}
          />
          <p className="text-muted-foreground text-xs">0 turns the guard off.</p>
        </div>
      </div>
      {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}

export function UserForm() {
  const [state, action, pending] = useActionState(addUser, {})

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t pt-4">
      <div className="flex-1 space-y-1">
        <Label htmlFor="new-email" className="text-xs">
          Add user
        </Label>
        <Input id="new-email" name="email" type="email" placeholder="kollega@kumpan.se" required />
      </div>
      <PasswordInput
        name="password"
        placeholder="Password (10+)"
        minLength={10}
        required
        className="w-44"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Adding…' : 'Add'}
      </Button>
      {state.error ? <p className="text-destructive w-full text-sm">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}
    </form>
  )
}
