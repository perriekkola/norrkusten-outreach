'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { CampaignDraft } from '@/lib/ai'
import type { Campaign } from '@/lib/db'
import { formatDetail, readProgress, type Progress } from '@/lib/stream'
import { CampaignForm } from '../campaign-form'

/**
 * The same "let Claude write it" affordance the new-campaign page has, pointed at a
 * campaign that already exists. It only fills the form in — nothing is written until the
 * user reads the fields and presses Save changes, which is the point: a revision is a
 * suggestion to check, not an edit applied behind your back.
 */
export function ReviseCampaign({
  campaign,
  searches,
  mailboxes,
}: {
  campaign: Campaign
  searches: { id: number; label: string; leads: number }[]
  mailboxes: { id: number; name: string; from_email: string; is_default: boolean }[]
}) {
  const [instruction, setInstruction] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<CampaignDraft | undefined>()
  /** Bumped per revision so the uncontrolled fields remount onto the new values. */
  const [revision, setRevision] = useState(0)
  const working = progress !== null

  async function revise() {
    setError(null)
    setProgress({ phase: 'Starting' })
    try {
      setDraft(
        await readProgress<CampaignDraft>(
          `/api/campaigns/${campaign.id}/revise`,
          { instruction },
          setProgress,
        ),
      )
      setRevision((n) => n + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            Ask Claude to change it
          </CardTitle>
          <CardDescription>
            Say what you want different — &ldquo;actually, drop the third email&rdquo;,
            &ldquo;target maintenance managers too&rdquo;, &ldquo;make the tone less formal&rdquo;.
            Claude rewrites the fields below and leaves the rest alone. Nothing is saved until
            you read them and press Save changes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            disabled={working}
            placeholder={
              'Ta även med underhållschefer och driftchefer i målgruppen, och gör tonen lite ' +
              'mindre formell.'
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={revise} disabled={working || !instruction.trim()}>
              {working ? <Spinner /> : null}
              {working ? 'Working…' : 'Apply change'}
            </Button>
            {working ? (
              <span className="text-muted-foreground min-w-0 max-w-[min(24rem,60vw)] truncate text-xs">
                {progress.phase}
                {progress.detail ? ` · ${formatDetail(progress.detail)}` : ''}
              </span>
            ) : null}
            {error ? <span className="text-destructive text-sm">{error}</span> : null}
            {draft && !working ? (
              <span className="text-sm text-green-600 dark:text-green-400">
                Updated below — check the fields, then Save changes.
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Remounted per revision so the uncontrolled fields pick up the new values. */}
      <CampaignForm
        key={revision}
        campaign={campaign}
        searches={searches}
        mailboxes={mailboxes}
        draft={draft}
      />
    </div>
  )
}
