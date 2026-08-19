'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addUser, saveSettings } from '@/lib/actions'

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
      <Input
        name="password"
        type="password"
        placeholder="Password (10+)"
        minLength={10}
        required
        className="w-44"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? '…' : 'Add'}
      </Button>
      {state.error ? <p className="text-destructive w-full text-sm">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}
    </form>
  )
}
