'use client'

import { useActionState, useState } from 'react'
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
import type { Campaign, CampaignStep } from '@/lib/db'

const DEFAULT_STEPS: CampaignStep[] = [
  { delay_days: 0, goal: 'Intro: why we are reaching out, one concrete hook, ask for a 15-min call.' },
  { delay_days: 4, goal: 'Follow-up: add one new angle or proof point. Keep it to three sentences.' },
  { delay_days: 7, goal: 'Break-up: short, no pressure, leave the door open.' },
]

export function CampaignForm({ campaign }: { campaign?: Campaign }) {
  const [state, action, pending] = useActionState(saveCampaign, {})
  const [steps, setSteps] = useState<CampaignStep[]>(campaign?.steps.length ? campaign.steps : DEFAULT_STEPS)

  return (
    <form action={action} className="max-w-2xl space-y-6">
      {campaign ? <input type="hidden" name="id" value={campaign.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" defaultValue={campaign?.name} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="from_name">Sender name</Label>
          <Input
            id="from_name"
            name="from_name"
            defaultValue={campaign?.from_name ?? ''}
            placeholder="Per Riekkola"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="icp">Who this campaign targets</Label>
        <Textarea
          id="icp"
          name="icp"
          rows={10}
          defaultValue={campaign?.icp}
          placeholder="The scoring rubric for this campaign only. Who is a strong fit, who is medium, who is a poor fit — and why. Claude scores every enrolled lead against this text."
        />
        <p className="text-muted-foreground text-xs">
          Scored per campaign, so the same lead can be strong here and weak elsewhere.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="offer">What you are selling</Label>
        <Textarea
          id="offer"
          name="offer"
          rows={5}
          defaultValue={campaign?.offer}
          placeholder="Describe the courses, who they help and the outcome. Claude uses this verbatim when writing."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="language">Language</Label>
          <Select name="language" defaultValue={campaign?.language ?? 'sv'}>
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
          Send without approval
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Sequence</Label>
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
              <Label className="text-xs">
                {index === 0 ? 'Send' : 'Wait (days)'}
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
              <Label className="text-xs">Goal of this email</Label>
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
