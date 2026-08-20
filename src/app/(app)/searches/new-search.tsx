'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import type { SearchDraft } from '@/lib/ai'
import { formatDetail, readProgress, type Progress } from '@/lib/stream'
import { SearchForm } from './search-form'

export function NewSearch() {
  const [brief, setBrief] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<SearchDraft | undefined>()
  // Bumped per run so a second suggestion remounts the form even if it looks the same.
  const [runs, setRuns] = useState(0)
  const generating = progress !== null

  async function generate() {
    setError(null)
    setProgress({ phase: 'Starting' })
    try {
      setDraft(await readProgress<SearchDraft>('/api/searches/draft', { brief }, setProgress))
      setRuns((count) => count + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4" />
            Fill the filters for me
          </CardTitle>
          <CardDescription>
            Describe who you want to reach, or paste the course page you want to sell. Claude picks
            the job titles, industries and locations from Apify&rsquo;s own lists and fills in the
            form below for you to adjust.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            disabled={generating}
            placeholder={
              'HR- och utbildningsansvariga på svenska tillverkande bolag med 50–500 anställda'
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generate} disabled={generating || !brief.trim()}>
              {generating ? <Spinner /> : null}
              {generating ? 'Working…' : 'Suggest filters'}
            </Button>
            {generating ? (
              <span className="text-muted-foreground min-w-0 max-w-[min(24rem,60vw)] truncate text-xs">
                {progress.phase}
                {progress.detail ? ` · ${formatDetail(progress.detail)}` : ''}
              </span>
            ) : null}
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          {draft && !generating ? (
            <p className="text-sm text-green-600 dark:text-green-400">
              Filled in below. Check it before starting — a wrong filter costs an Apify run.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Remounted when a draft arrives so the uncontrolled fields pick up the new values. */}
      <SearchForm key={runs} draft={draft} />
    </div>
  )
}
