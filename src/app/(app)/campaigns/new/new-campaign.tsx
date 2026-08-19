'use client'

import { Sparkles } from 'lucide-react'
import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { generateCampaign } from '@/lib/actions'
import { CampaignForm } from '../campaign-form'

export function NewCampaign({
  searches,
  mailboxes,
}: {
  searches: { id: number; label: string; leads: number }[]
  mailboxes: { id: number; name: string; from_email: string; is_default: boolean }[]
}) {
  const [state, generate, generating] = useActionState(generateCampaign, {})

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
            edit before anything is created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={generate} className="space-y-3">
            <Textarea
              name="brief"
              rows={4}
              defaultValue={state.draft ? undefined : ''}
              placeholder={
                'Sälj den här kursen till svenska maskinbyggare:\n' +
                'https://norrkusten.se/nya-maskinforordningen/'
              }
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={generating}>
                {generating ? 'Reading the pages…' : 'Draft campaign'}
              </Button>
              {generating ? (
                <span className="text-muted-foreground text-xs">
                  Fetching each link and checking the claims — this takes a minute.
                </span>
              ) : null}
              {state.error ? <span className="text-destructive text-sm">{state.error}</span> : null}
              {state.ok ? (
                <span className="text-sm text-green-600 dark:text-green-400">{state.ok}</span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Remounted when a draft arrives so the uncontrolled fields pick up the new values. */}
      <CampaignForm
        key={state.draft ? 'drafted' : 'blank'}
        searches={searches}
        mailboxes={mailboxes}
        draft={state.draft}
      />
    </div>
  )
}
