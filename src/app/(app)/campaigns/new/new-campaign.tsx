'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { CampaignDraft } from '@/lib/ai'
import type { WritingMode } from '@/lib/db'
import { formatDetail, readProgress, type Progress } from '@/lib/stream'
import { CampaignForm } from '../campaign-form'

export function NewCampaign({
  searches,
  mailboxes,
}: {
  searches: { id: number; label: string; leads: number }[]
  mailboxes: { id: number; name: string; from_email: string; is_default: boolean }[]
}) {
  const [brief, setBrief] = useState('')
  // Held here rather than in the form: choosing "the same email for everyone" before
  // pressing Draft is what tells Claude to write the emails instead of the goals.
  const [writingMode, setWritingMode] = useState<WritingMode>('ai')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<CampaignDraft | undefined>()
  const generating = progress !== null

  async function generate() {
    setError(null)
    setProgress({ phase: 'Starting' })
    try {
      setDraft(
        await readProgress<CampaignDraft>(
          '/api/campaigns/draft',
          { brief, writingMode },
          setProgress,
        ),
      )
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
            Draft it for me
          </CardTitle>
          <CardDescription>
            Paste the course pages you want to sell, or just describe it. Claude reads the pages
            and fills in every field below — targeting, offer, tone and the sequence — for you to
            edit before anything is created. Set &ldquo;How the emails are written&rdquo; below
            first: pick the fixed option and Claude writes the actual emails rather than the
            goals behind them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={4}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            disabled={generating}
            placeholder={
              'Sälj den här kursen till svenska maskinbyggare:\n' +
              'https://norrkusten.se/nya-maskinforordningen/'
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generate} disabled={generating || !brief.trim()}>
              {generating ? <Spinner /> : null}
              {generating ? 'Working…' : 'Draft campaign'}
            </Button>
            {generating ? (
              <span className="text-muted-foreground min-w-0 max-w-[min(24rem,60vw)] truncate text-xs">
                {progress.phase}
                {progress.detail ? ` · ${formatDetail(progress.detail)}` : ''}
              </span>
            ) : null}
            {error ? <span className="text-destructive text-sm">{error}</span> : null}
            {draft && !generating ? (
              <span className="text-sm text-green-600 dark:text-green-400">
                Drafted. Read every field before creating — it can get things wrong.
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Remounted when a draft arrives so the uncontrolled fields pick up the new values. */}
      <CampaignForm
        key={draft ? 'drafted' : 'blank'}
        writingMode={writingMode}
        onWritingModeChange={setWritingMode}
        searches={searches}
        mailboxes={mailboxes}
        draft={draft}
      />
    </div>
  )
}
