'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import type { CampaignPass } from '@/lib/engine'
import { formatDetail, readProgress, type Progress } from '@/lib/stream'

/** `blocked` is why a run cannot happen, shown next to the button — a disabled button
 * with no reason is the whole bug this prop exists to fix. */
export function RunButton({ campaignId, blocked }: { campaignId: number; blocked?: string }) {
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
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {/* Button and hint travel together — wrapping between them orphans the icon. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={run} disabled={running || Boolean(blocked)}>
          {running ? <Spinner /> : null}
          {running ? 'Running…' : 'Run now'}
        </Button>
        <Hint label="What Run now does">
          Three things, for this campaign only: enrol every lead from the ticked searches, score
          the unscored against this campaign&apos;s profile, then draft the emails that are due —
          best score first, researching each company as it goes. It never sends. Drafts land in
          the outbox. Safe to press repeatedly; each pass skips finished work and stops before the
          server timeout, so large batches need a few clicks.
        </Hint>
      </div>

      {running ? (
        <span className="text-muted-foreground min-w-0 basis-full truncate text-xs sm:basis-auto sm:max-w-[24rem]">
          {progress.phase}
          {progress.detail ? ` · ${formatDetail(progress.detail)}` : ''}
        </span>
      ) : null}
      {result ?? blocked ? (
        <span className="text-muted-foreground min-w-0 basis-full text-xs sm:basis-auto sm:max-w-[28rem]">
          {result ?? blocked}
        </span>
      ) : null}
    </div>
  )
}
