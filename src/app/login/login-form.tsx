'use client'

import { useActionState } from 'react'
import { PasswordInput } from '@/components/password-input'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn } from '@/lib/actions'

export function LoginForm({ firstRun }: { firstRun: boolean }) {
  const [state, action, pending] = useActionState(signIn, {})

  return (
    <form action={action} className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{firstRun ? 'Create admin account' : 'Sign in'}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {firstRun
            ? 'No account exists yet. The first one you create becomes the admin.'
            : 'Admin access only.'}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete={firstRun ? 'new-password' : 'current-password'}
          minLength={firstRun ? 10 : undefined}
          required
        />
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Working…' : firstRun ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  )
}
