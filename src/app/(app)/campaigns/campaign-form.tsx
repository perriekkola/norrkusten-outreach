'use client'

import { useActionState, useState } from 'react'
import { Hint } from '@/components/hint'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { saveCampaign } from '@/lib/actions'
import type { CampaignDraft } from '@/lib/ai'
import type { Campaign, CampaignStep } from '@/lib/db'

const DEFAULT_STEPS: CampaignStep[] = [
  { delay_days: 0, goal: 'Intro: why we are reaching out, one concrete hook, ask for a 15-min call.' },
  { delay_days: 4, goal: 'Follow-up: add one new angle or proof point. Keep it to three sentences.' },
  { delay_days: 7, goal: 'Break-up: short, no pressure, leave the door open.' },
]

export function CampaignForm({
  campaign,
  searches,
  draft,
}: {
  campaign?: Campaign
  searches: { id: number; label: string; leads: number }[]
  /** An AI-generated starting point. Fields stay editable — this only seeds them. */
  draft?: CampaignDraft
}) {
  const [state, action, pending] = useActionState(saveCampaign, {})
  const initial = draft ?? campaign
  const [steps, setSteps] = useState<CampaignStep[]>(
    initial?.steps?.length ? initial.steps : DEFAULT_STEPS,
  )
  const [links, setLinks] = useState<string[]>(
    draft?.links?.length ? draft.links : campaign?.links?.length ? campaign.links : [''],
  )

  return (
    <form action={action} className="max-w-2xl space-y-6">
      {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={initial?.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="from_name" className="flex items-center gap-1.5">
            Sender name
            <Hint>
              Who signs the emails. This is the signature only — the actual From address comes
              from the FROM_EMAIL environment variable.
            </Hint>
          </Label>
          <Input
            id="from_name"
            name="from_name"
            defaultValue={campaign?.from_name ?? ''}
            placeholder="Per Riekkola"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          Pull leads from these searches
          <Hint>
            Every lead from the ticked searches is enrolled and scored automatically each time
            the campaign runs. Re-run a search later and the new leads join on the next pass.
            Leave all unticked to enrol by hand from the Leads page instead.
          </Hint>
        </Label>
        <div className="space-y-2 rounded-lg border p-3">
          {searches.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No searches with leads yet — run one first and this campaign will pick them up.
            </p>
          ) : (
            searches.map((search) => (
              <label key={search.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  name="source_search_ids"
                  value={search.id}
                  defaultChecked={initial?.source_search_ids?.includes(search.id)}
                />
                {search.label}
                <span className="text-muted-foreground text-xs">({search.leads})</span>
              </label>
            ))
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          Every lead from these searches is enrolled and scored automatically. Re-running a search
          adds the new leads on the next pass.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="min_score" className="flex items-center gap-1.5">
          Minimum score to contact
          <Hint>
            The gate on everything downstream. Below this a lead is never researched, drafted or
            emailed — but it stays enrolled and visible so you can read why it scored low.
            50 is a reasonable default; raise it if the drafts feel like a stretch.
          </Hint>
        </Label>
        <Input
          id="min_score"
          name="min_score"
          type="number"
          min={0}
          max={100}
          defaultValue={initial?.min_score ?? 50}
          className="w-32"
        />
        <p className="text-muted-foreground text-xs">
          Below this, a lead is never researched, drafted or emailed. It stays enrolled so you can
          see why it scored low.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="icp" className="flex items-center gap-1.5">
          Who this campaign targets
          <Hint>
            The scoring rubric, and the only thing scoring reads besides the scraped lead data.
            Say who is a strong fit, who is medium, who is a poor fit, and why. Naming who is a
            poor fit matters as much as who is good — it is what stops competitors and
            irrelevant industries scoring high.
          </Hint>
        </Label>
        <Textarea
          id="icp"
          name="icp"
          rows={10}
          defaultValue={initial?.icp}
          placeholder="The scoring rubric for this campaign only. Who is a strong fit, who is medium, who is a poor fit — and why. Claude scores every enrolled lead against this text."
        />
        <p className="text-muted-foreground text-xs">
          Scored per campaign, so the same lead can be strong here and weak elsewhere.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="offer" className="flex items-center gap-1.5">
          What you are selling
          <Hint>
            Used when writing each email, not when scoring. Claude treats this as fact, so
            anything inaccurate here becomes a claim in a real email. Include the concrete
            detail worth citing — a deadline, what changes, the specific outcome.
          </Hint>
        </Label>
        <Textarea
          id="offer"
          name="offer"
          rows={5}
          defaultValue={initial?.offer}
          placeholder="Describe the courses, who they help and the outcome. Claude uses this verbatim when writing."
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            Links to include
            <Hint>
              The pages these emails drive to. Add several when the campaign pitches more than
              one course — Claude picks the most relevant one per email and never invents a URL
              outside this list. Links in sent mail are rewritten through a tracker so clicks
              show up in Analytics.
            </Hint>
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLinks((current) => [...current, ''])}
          >
            Add link
          </Button>
        </div>
        {links.map((link, index) => (
          <div key={index} className="flex gap-2">
            <Input
              name="links"
              type="url"
              defaultValue={link}
              placeholder="https://norrkusten.se/kurser/..."
            />
            {links.length > 1 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setLinks((current) => current.filter((_, i) => i !== index))}
              >
                ✕
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="guidelines" className="flex items-center gap-1.5">
          How the emails should read
          <Hint>
            Campaign-specific rules that override the defaults — what to ask for, tone, phrases
            to avoid. This is the dial to turn when the drafts come out wrong. Example: &ldquo;Ask
            them to read the course page and reply with questions. Never propose a meeting.&rdquo;
          </Hint>
        </Label>
        <Textarea
          id="guidelines"
          name="guidelines"
          rows={5}
          defaultValue={initial?.guidelines}
          placeholder={
            'Be be konkret och kort. Avsluta med att be dem läsa kurssidan och svara om de har ' +
            'frågor — föreslå aldrig ett möte.'
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="language" className="flex items-center gap-1.5">
            Language
            <Hint>The language Claude writes the emails in. It does not filter leads.</Hint>
          </Label>
          <Select name="language" defaultValue={initial?.language ?? 'sv'}>
            <SelectTrigger id="language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { value: 'sv', label: 'Swedish' },
                { value: 'en', label: 'English' },
                { value: 'no', label: 'Norwegian' },
                { value: 'da', label: 'Danish' },
                { value: 'fi', label: 'Finnish' },
              ].map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <Checkbox name="auto_send" defaultChecked={campaign?.auto_send} />
          Send without approval, best scores first
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            Sequence
            <Hint>
              Goals, not templates. Claude writes a fresh email per lead from the goal, the
              offer, the research and the earlier emails in that thread. A reply stops the
              sequence for that lead automatically.
            </Hint>
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSteps((s) => [...s, { delay_days: 5, goal: '' }])}
          >
            Add step
          </Button>
        </div>

        {steps.map((step, index) => (
          <div key={index} className="flex gap-3 rounded-lg border p-3">
            <div className="w-28 shrink-0 space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                {index === 0 ? 'Send' : 'Wait (days)'}
                {index === 1 ? (
                  <Hint>Days to wait after the previous email in this sequence was sent.</Hint>
                ) : null}
              </Label>
              <Input
                name="step_delay"
                type="number"
                min={0}
                defaultValue={index === 0 ? 0 : step.delay_days}
                disabled={index === 0}
                className="disabled:opacity-60"
              />
              {index === 0 ? <input type="hidden" name="step_delay" value={0} /> : null}
            </div>
            <div className="flex-1 space-y-1">
              <Label className="flex items-center gap-1 text-xs">
                Goal of this email
                {index === 0 ? (
                  <Hint>
                    What this email should achieve, in your words. Be specific about what to
                    avoid too — &ldquo;no product presentation, no price list&rdquo; works.
                  </Hint>
                ) : null}
              </Label>
              <Textarea name="step_goal" rows={2} defaultValue={step.goal} />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground self-start"
              onClick={() => setSteps((s) => s.filter((_, i) => i !== index))}
            >
              ✕
            </Button>
          </div>
        ))}
      </div>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
      </Button>
    </form>
  )
}
