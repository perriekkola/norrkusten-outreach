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

export function SendingLimitsForm({
  cap,
  cooldown,
  spacing,
  rounds,
}: {
  cap: number
  cooldown: number
  spacing: number
  rounds: number
}) {
  const [state, action, pending] = useActionState(saveSendingLimits, {})

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="daily_send_cap" className="flex items-center gap-1.5">
            Emails per mailbox per day
            <Hint>
              Counted per mailbox over the last 24 hours, and each round takes half of it.
              Most senders sit at 40. Above 50, inbox providers start treating everything from
              your domain as spam, so this field will not go higher. Want more volume? Add
              another mailbox instead.
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
              Counted across every campaign at once. Without it, five campaigns drawing on
              similar searches each email the same person, who sees you mailing them five
              times. Send now ignores this. The automatic round does not.
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

        <div className="space-y-2">
          <Label htmlFor="send_spacing_seconds" className="flex items-center gap-1.5">
            Seconds between emails
            <Hint>
              How long to wait after each email before sending the next. Mail servers refuse
              a burst even when the daily total is fine, and every mailbox here leaves
              through the same one. If the outbox keeps saying emails were held back, raise
              this. Slower is always safe.
            </Hint>
          </Label>
          <Input
            id="send_spacing_seconds"
            name="send_spacing_seconds"
            type="number"
            min={0}
            max={120}
            defaultValue={spacing}
          />
          <p className="text-muted-foreground text-xs">
            At most about {spacing > 0 ? Math.floor(60 / spacing) : 60} a minute.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="rounds_per_day" className="flex items-center gap-1.5">
            Rounds a day
            <Hint>
              How many times a day the schedule runs. The daily allowance is divided by
              this, so more rounds means smaller batches at a time, not more email. Set it
              to match the real schedule: if you add times to vercel.json or point a GitHub
              Action at the site, change this too, or the early rounds will use the whole
              day and the later ones will find nothing left.
            </Hint>
          </Label>
          <Input
            id="rounds_per_day"
            name="rounds_per_day"
            type="number"
            min={1}
            max={48}
            defaultValue={rounds}
          />
          <p className="text-muted-foreground text-xs">
            About {Math.ceil(cap / Math.max(1, rounds))} per mailbox each round.
          </p>
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
