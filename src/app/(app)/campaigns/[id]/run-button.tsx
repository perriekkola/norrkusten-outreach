'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import type { CampaignPass } from '@/lib/engine'
import { readProgress, type Progress } from '@/lib/stream'

export function RunButton({ campaignId, disabled }: { campaignId: number; disabled: boolean }) {
  const router = useRouter()
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const running = progress !== null

  async function run() {
    setResult(null)
    setProgress({ phase: 'Starting' })
    try {
      const pass = await readProgress<CampaignPass>(
        `/api/campaigns/${campaignId}/run`,
        {},
        setProgress,
      )
      const did = [
        pass.enrolled && `enrolled ${pass.enrolled}`,
        pass.scored && `scored ${pass.scored}`,
        pass.drafted && `drafted ${pass.drafted}`,
      ].filter(Boolean)
      const left = [
        pass.unscored && `${pass.unscored} still unscored`,
        pass.due && `${pass.due} still to draft`,
      ].filter(Boolean)
      setResult(
        [
          did.length ? did.join(', ') : 'Nothing new to do',
          left.length ? `${left.join(' and ')} — run again to continue` : null,
          pass.failed ? `${pass.failed} failed: ${pass.reason}` : null,
        ]
          .filter(Boolean)
          .join('. '),
      )
      router.refresh()
    } catch (error) {
      setResult(error instanceof Error ? error.message : String(error))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={run} disabled={running || disabled}>
        {running ? <Spinner /> : null}
        {running ? 'Running…' : 'Run now'}
      </Button>
      <Hint label="What Run now does">
        Three things, for this campaign only: enrol every lead from the ticked searches, score the
        unscored against this campaign&apos;s profile, then draft the emails that are due — best
        score first, researching each company as it goes. It never sends. Drafts land in the
        outbox. Safe to press repeatedly; each pass skips finished work and stops before the
        server timeout, so large batches need a few clicks.
      </Hint>
      {running ? (
        <span className="text-muted-foreground max-w-md truncate text-xs">
          {progress.phase}
          {progress.detail ? ` · ${progress.detail}` : ''}
        </span>
      ) : null}
      {result ? <span className="text-muted-foreground text-xs">{result}</span> : null}
    </div>
  )
}
