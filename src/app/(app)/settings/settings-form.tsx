'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { addUser, saveSettings } from '@/lib/actions'

export function SettingsForm({ icp, senderName }: { icp: string; senderName: string }) {
  const [state, action, pending] = useActionState(saveSettings, {})

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="icp">Who we sell to</Label>
        <Textarea
          id="icp"
          name="icp"
          rows={12}
          defaultValue={icp}
          placeholder={
            'We sell e-learning courses in … to Swedish companies with 50-500 employees.\n\n' +
            'Best fit: HR managers, L&D leads and operations managers who own a training budget.\n\n' +
            'Poor fit: students, consultants selling training themselves, companies under 20 people.'
          }
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="sender_name">Default sender name</Label>
        <Input id="sender_name" name="sender_name" defaultValue={senderName} />
      </div>
      {state.ok ? <p className="text-sm text-green-600">{state.ok}</p> : null}
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
      {state.ok ? <p className="w-full text-sm text-green-600">{state.ok}</p> : null}
    </form>
  )
}
