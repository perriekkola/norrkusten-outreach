'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/hint'
import { runCampaignNow } from '@/lib/actions'

export function RunButton({ campaignId, disabled }: { campaignId: number; disabled: boolean }) {
  const [state, action, pending] = useActionState(runCampaignNow, {})

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <Button type="submit" size="sm" disabled={pending || disabled}>
        {pending ? 'Running…' : 'Run now'}
      </Button>
      <Hint label="What Run now does">
        Three things, for this campaign only: enrol every lead from the ticked searches, score
        the unscored against this campaign&apos;s profile, then draft the emails that are due —
        best score first, researching each company as it goes. It never sends. Drafts land in
        the outbox. Safe to press repeatedly; each pass skips finished work and stops before the
        server timeout, so large batches need a few clicks.
      </Hint>
      {state.ok ? <span className="text-muted-foreground text-xs">{state.ok}</span> : null}
    </form>
  )
}
