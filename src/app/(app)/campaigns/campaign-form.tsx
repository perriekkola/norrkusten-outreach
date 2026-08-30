'use client'

import { useActionState, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Hint } from '@/components/hint'
import { Spinner } from '@/components/spinner'
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
import { replaceDrafts, rescoreCampaign, saveCampaign } from '@/lib/actions'
import type { CampaignDraft } from '@/lib/ai'
import type { Campaign, CampaignStep, WritingMode } from '@/lib/db'
import { TEMPLATE_FIELDS } from '@/lib/format'

/**
 * The placeholder list, visible rather than buried in a tooltip.
 *
 * Someone writing a fixed email has to know what they can drop in without going to look it
 * up, so every token is on screen with what it renders to, and clicking one copies it.
 */
function Placeholders() {
  const [copied, setCopied] = useState<string | null>(null)

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-xs font-medium">Placeholders — click to copy</p>
      <div className="flex flex-wrap gap-2">
        {TEMPLATE_FIELDS.map(({ field, example, note }) => {
          const token = `{{${field}}}`
          return (
            <button
              key={field}
              type="button"
              title={note}
              onClick={() => {
                void navigator.clipboard?.writeText(token).catch(() => {})
                setCopied(field)
              }}
              className="bg-muted/60 hover:bg-muted rounded-md border px-2 py-1 text-left"
            >
              <code className="text-xs">{token}</code>
              <span className="text-muted-foreground ml-2 text-xs">
                {copied === field ? 'copied' : example}
              </span>
            </button>
          )
        })}
      </div>
      <p className="text-muted-foreground text-xs">
        Filled in per lead. Anything else is left exactly as typed, so a misspelt token
        arrives visible in a test send instead of going out blank. A lead with no first name
        leaves &ldquo;Hej,&rdquo; rather than &ldquo;Hej ,&rdquo;.
      </p>
    </div>
  )
}

const DEFAULT_STEPS: CampaignStep[] = [
  {
    delay_days: 0,
    goal:
      'Intro: why we are reaching out, one concrete hook, then send them to the course page ' +
      'to read the details and buy. Do not ask for a meeting or a call.',
  },
  { delay_days: 4, goal: 'Follow-up: add one new angle or proof point. Keep it to three sentences.' },
  { delay_days: 7, goal: 'Break-up: short, no pressure, leave the door open.' },
]

export function CampaignForm({
  campaign,
  writingMode,
  onWritingModeChange,
  searches,
  mailboxes,
  draft,
}: {
  campaign?: Campaign
  /** Owned by the page, so the AI draft and revise boxes can send it too. */
  writingMode: WritingMode
  onWritingModeChange: (mode: WritingMode) => void
  searches: { id: number; label: string; leads: number }[]
  mailboxes: { id: number; name: string; from_email: string; is_default: boolean }[]
  /** An AI-generated starting point. Fields stay editable — this only seeds them. */
  draft?: CampaignDraft
}) {
  const [state, action, pending] = useActionState(saveCampaign, {})

  /**
   * Some saves leave a question behind — a changed rubric does not re-score anything by
   * itself, and new wording does not touch drafts already queued. They are asked here, one
   * after another, rather than decided silently.
   *
   * Derived rather than copied into state: each save returns a fresh id, so the position in
   * the queue resets on its own and no effect has to sync one piece of state into another.
   */
  const [seen, setSeen] = useState<{ id?: string; index: number }>({ index: 0 })
  const index = seen.id === state.followUpId ? seen.index : 0
  const followUp = state.followUps?.[index] ?? null
  const nextFollowUp = () => setSeen({ id: state.followUpId, index: index + 1 })

  const fixed = writingMode === 'fixed'
  const initial = draft ?? campaign
  const [steps, setSteps] = useState<CampaignStep[]>(() => {
    const base: CampaignStep[] = initial?.steps?.length ? initial.steps : DEFAULT_STEPS
    // A revision from Claude rewrites goals and knows nothing about a fixed campaign's
    // subject and body, so carry those across by position rather than losing them.
    return draft && campaign
      ? base.map((step, i) => ({
          ...step,
          // '||' not '??': an ai-mode revision returns empty strings, and those must fall
          // back to the stored wording rather than blank a fixed campaign's emails.
          subject: step.subject || campaign.steps[i]?.subject,
          body: step.body || campaign.steps[i]?.body,
        }))
      : base
  })
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
          required
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
            {fixed
              ? 'Not sent anywhere on its own — with a fixed campaign this is what Claude ' +
                'reads when you ask it to write or change the emails above. Claude treats it ' +
                'as fact, so anything inaccurate here can end up in one of them.'
              : 'Used when writing each email, not when scoring. Claude treats this as fact, ' +
                'so anything inaccurate here becomes a claim in a real email. Include the ' +
                'concrete detail worth citing — a deadline, what changes, the specific outcome.'}
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
              {fixed
                ? 'With a fixed campaign the URL goes in the body itself. These are what ' +
                  'Claude points at when it writes or changes those emails for you. Any link ' +
                  'in a sent email is rewritten through a tracker, wherever it came from, so ' +
                  'clicks show up in Analytics either way.'
                : 'The pages these emails drive to. Add several when the campaign pitches ' +
                  'more than one course — Claude picks the most relevant one per email and ' +
                  'never invents a URL outside this list. Links in sent mail are rewritten ' +
                  'through a tracker so clicks show up in Analytics.'}
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
            {fixed
              ? 'Read only when Claude writes or revises the fixed emails above — nothing ' +
                'applies it at send time, because the wording is already settled. Say the ' +
                'tone and what to avoid, and asking for a change will respect it.'
              : 'Campaign-specific rules that override the defaults — what to ask for, tone, ' +
                'phrases to avoid. This is the dial to turn when the drafts come out wrong. ' +
                'Example: "Ask them to read the course page and reply with questions. Never ' +
                'propose a meeting."'}
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
          <Label htmlFor="mailbox_id" className="flex items-center gap-1.5">
            Send from
            <Hint>
              Which mailbox delivers this campaign, and where replies are watched for. Manage
              these under Settings. &ldquo;Default mailbox&rdquo; follows whichever one is marked
              default, so it changes if you change that.
            </Hint>
          </Label>
          <Select
            name="mailbox_id"
            defaultValue={campaign?.mailbox_id ? String(campaign.mailbox_id) : 'default'}
          >
            <SelectTrigger id="mailbox_id" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default mailbox</SelectItem>
              {mailboxes.map((mailbox) => (
                <SelectItem key={mailbox.id} value={String(mailbox.id)}>
                  {mailbox.name} — {mailbox.from_email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
        <div className="flex items-end gap-1.5 pb-2">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox name="auto_send" defaultChecked={campaign?.auto_send} />
            Send without approval, best scores first
          </label>
          <Hint>
            {fixed
              ? 'Worth considering for a fixed campaign. Approving each email one by one is ' +
                'reading your own words back three hundred times — you wrote them. What ' +
                'approval still gates is who receives them, and that part is a judgement ' +
                'call the scoring made, not you. Leave this off while you are still checking ' +
                'the scores; turn it on once the outbox stops surprising you.'
              : 'Off by default, deliberately. Every email is written per lead by a model, ' +
                'so the outbox is where you read one before a real person does. Turning this ' +
                'on sends them at the next automatic round with nobody looking.'}
          </Hint>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="writing_mode" className="flex items-center gap-1.5">
          How the emails are written
          <Hint>
            Claude writing each one is what makes a cold email read as though a person sent
            it, and it is the setting to keep unless you have a reason not to. Choose the
            fixed option when the wording has to be exactly what you approved — a legal
            notice, a price announcement, anything you cannot let a model rephrase. A fixed
            campaign also costs nothing to write and skips company research entirely.
          </Hint>
        </Label>
        <input type="hidden" name="writing_mode" value={writingMode} />
        <Select
          value={writingMode}
          onValueChange={(value) => onWritingModeChange(value as WritingMode)}
        >
          <SelectTrigger id="writing_mode" className="w-full sm:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ai">Claude writes each email for the lead</SelectItem>
            <SelectItem value="fixed">The same email for everyone</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          {fixed
            ? 'Every lead gets exactly what you type below. Scoring still decides who is ' +
              'written to; nothing is researched and no email is generated.'
            : 'Claude writes a fresh email per lead from the goal, the offer and the research.'}
        </p>
      </div>

      {fixed ? <Placeholders /> : null}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            Sequence
            <Hint>
              One entry per email, in order. A reply stops the sequence for that lead
              automatically, whichever way the emails are written. Follow-ups need filling in
              too — a fixed campaign cannot invent the second email when it gets there.
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
          <div key={index} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row">
            <div className="space-y-1 sm:w-28 sm:shrink-0">
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
            {/* Both sets are always in the form, so switching mode and back does not throw
                away what you wrote for the other one. Hidden fields still submit. */}
            <div className="flex-1 space-y-1" hidden={fixed}>
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

            <div className="flex-1 space-y-2" hidden={!fixed}>
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs">
                  Subject
                  {index === 0 ? (
                    <Hint>
                      Sent exactly as typed, with the placeholders above filled in per lead.
                    </Hint>
                  ) : null}
                </Label>
                <Input name="step_subject" defaultValue={step.subject ?? ''} />
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1 text-xs">
                  Body
                  {index === 0 ? (
                    <Hint>
                      Plain text, no sign-off — the mailbox signature and the opt-out line are
                      added underneath automatically, so writing your own would produce two.
                    </Hint>
                  ) : null}
                </Label>
                <Textarea
                  name="step_body"
                  rows={8}
                  defaultValue={step.body ?? ''}
                  placeholder={'Hej {{first_name}},\n\n…\n\nhttps://norrkusten.se/kurser/...'}
                />
              </div>
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

      {/* One dialog, driven by whichever question is at the front of the queue. */}
      <AlertDialog open={followUp !== null} onOpenChange={(open) => !open && nextFollowUp()}>
        <AlertDialogContent>
          {followUp?.kind === 'rescore' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Re-score against the new targeting?</AlertDialogTitle>
                <AlertDialogDescription>
                  You changed who this campaign targets. {followUp.stale} lead
                  {followUp.stale === 1 ? ' is' : 's are'} still scored against the old
                  wording, and scoring never runs twice on its own — without this they keep
                  their old numbers and only new leads get the new rubric. Anyone already
                  emailed keeps their score either way. Re-scoring costs nothing now; the next
                  passes do the work and the campaign shows the estimate first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Only score new leads</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const data = new FormData()
                    data.set('campaignId', String(followUp.campaignId))
                    nextFollowUp()
                    // The page refreshes from the server either way, so the Score column is
                    // the feedback; catch only so a failure is not an unhandled rejection.
                    void rescoreCampaign(data).catch(console.error)
                  }}
                >
                  Re-score all {followUp.stale}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}

          {followUp?.kind === 'replaceDrafts' ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace the emails already waiting?</AlertDialogTitle>
                <AlertDialogDescription>
                  You changed what this campaign sends, but {followUp.pending} email
                  {followUp.pending === 1 ? '' : 's'} in the outbox{' '}
                  {followUp.pending === 1 ? 'was' : 'were'} written under the old settings and
                  {followUp.pending === 1 ? ' is' : ' are'} still queued exactly as before —
                  including anything already approved. Replacing throws those away so the next
                  pass writes them again; press Run now, or wait for the next automatic round. Nothing already
                  sent is touched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Leave them as they are</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    const data = new FormData()
                    data.set('campaignId', String(followUp.campaignId))
                    nextFollowUp()
                    void replaceDrafts(data).catch(console.error)
                  }}
                >
                  Replace {followUp.pending}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : null}
        </AlertDialogContent>
      </AlertDialog>

      {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
      {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? <Spinner /> : null}
        {pending ? 'Saving…' : campaign ? 'Save changes' : 'Create campaign'}
      </Button>
    </form>
  )
}
