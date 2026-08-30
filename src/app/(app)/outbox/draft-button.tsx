'use client'

import { useActionState } from 'react'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { generateDrafts } from '@/lib/actions'

export function DraftButton() {
  const [state, action, pending] = useActionState(generateDrafts, {})

  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Drafting…' : 'Draft due emails'}
      </Button>
      <Hint>
        Writes the next email for everyone whose turn has come, across every campaign. Each
        campaign&apos;s Run now does the same for itself, and so does the twice-daily round.
        This button is for when you do not want to wait.
      </Hint>
      {state.ok ? <span className="text-muted-foreground text-xs">{state.ok}</span> : null}
      {state.error ? <span className="text-destructive text-xs">{state.error}</span> : null}
    </form>
  )
}
