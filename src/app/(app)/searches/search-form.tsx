'use client'

import { useActionState } from 'react'
import { Spinner } from '@/components/spinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { MultiSelect } from '@/components/multi-select'
import { createSearch } from '@/lib/actions'
import type { SearchDraft } from '@/lib/ai'
import {
  COMPANY_SIZE,
  EMAIL_STATUS,
  FUNCTION,
  INDUSTRIES,
  LOCATIONS,
  REVENUE,
  SENIORITY,
  type Option,
} from '@/lib/apify-options'

function CheckGroup({
  name,
  options,
  selected,
}: {
  name: string
  options: Option[]
  selected?: readonly string[]
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Checkbox
            name={name}
            value={option.value}
            defaultChecked={selected?.includes(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium tracking-wide uppercase">{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

function RevenueSelect({ name, value }: { name: string; value?: string }) {
  return (
    // 'any' is how the model says "no filter" — the placeholder already covers that.
    <Select name={name} defaultValue={value && value !== 'any' ? value : undefined}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Any" />
      </SelectTrigger>
      <SelectContent>
        {REVENUE.map((value) => (
          <SelectItem key={value} value={value}>
            {value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Textareas take one value per line or comma-separated; the draft arrives as a list. */
const lines = (values?: string[]) => values?.join(', ')

export function SearchForm({ draft }: { draft?: SearchDraft }) {
  const [state, action, pending] = useActionState(createSearch, {})

  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="text-base">New search</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <Input
                name="label"
                placeholder="HR-chefer Sverige"
                defaultValue={draft?.label}
                required
              />
            </Field>
            <Field label="Max leads">
              <Input name="fetch_count" type="number" min={1} max={50000} defaultValue={100} />
            </Field>
          </div>

          <Field label="Job titles" hint="One per line or comma separated.">
            <Textarea
              name="contact_job_title"
              rows={3}
              placeholder={'HR-chef\nUtbildningsansvarig\nHead of People'}
              defaultValue={lines(draft?.contact_job_title)}
            />
          </Field>

          <Field label="Exclude job titles">
            <Textarea
              name="contact_not_job_title"
              rows={2}
              placeholder="praktikant, student"
              defaultValue={lines(draft?.contact_not_job_title)}
            />
          </Field>

          <Field label="Seniority">
            <CheckGroup
              name="seniority_level"
              options={SENIORITY}
              selected={draft?.seniority_level}
            />
          </Field>

          <Field label="Department">
            <CheckGroup
              name="functional_level"
              options={FUNCTION}
              selected={draft?.functional_level}
            />
          </Field>

          <Field label="Country / region" hint="Leave empty if you target cities instead.">
            <MultiSelect
              name="contact_location"
              options={LOCATIONS}
              placeholder="Search countries, regions, states…"
              emptyText="No location matches."
              defaultValue={draft?.contact_location}
            />
          </Field>

          <Field label="Cities" hint="Use instead of country for city-level targeting.">
            <Textarea
              name="contact_city"
              rows={2}
              placeholder="stockholm, göteborg"
              defaultValue={lines(draft?.contact_city)}
            />
          </Field>

          <Field label="Industries">
            <MultiSelect
              name="company_industry"
              options={INDUSTRIES}
              placeholder="Search Apify's industry list…"
              emptyText="No industry matches."
              defaultValue={draft?.company_industry}
            />
          </Field>

          <Field label="Company keywords">
            <Textarea
              name="company_keywords"
              rows={2}
              placeholder="utbildning, konsult"
              defaultValue={lines(draft?.company_keywords)}
            />
          </Field>

          <Field label="Exclude keywords">
            <Textarea
              name="company_not_keywords"
              rows={2}
              defaultValue={lines(draft?.company_not_keywords)}
            />
          </Field>

          <Field label="Company size">
            <CheckGroup name="size" options={COMPANY_SIZE} selected={draft?.size} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min revenue">
              <RevenueSelect name="min_revenue" value={draft?.min_revenue} />
            </Field>
            <Field label="Max revenue">
              <RevenueSelect name="max_revenue" value={draft?.max_revenue} />
            </Field>
          </div>

          <Field label="Email status">
            <CheckGroup name="email_status" options={EMAIL_STATUS} selected={draft?.email_status} />
          </Field>

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Spinner /> : null}
            {pending ? 'Starting…' : 'Start search'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
