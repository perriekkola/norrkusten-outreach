'use client'

import { useActionState } from 'react'
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

function CheckGroup({ name, options }: { name: string; options: Option[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Checkbox name={name} value={option.value} />
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

function RevenueSelect({ name }: { name: string }) {
  return (
    <Select name={name}>
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

export function SearchForm() {
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
              <Input name="label" placeholder="HR-chefer Sverige" required />
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
            />
          </Field>

          <Field label="Exclude job titles">
            <Textarea name="contact_not_job_title" rows={2} placeholder="praktikant, student" />
          </Field>

          <Field label="Seniority">
            <CheckGroup name="seniority_level" options={SENIORITY} />
          </Field>

          <Field label="Department">
            <CheckGroup name="functional_level" options={FUNCTION} />
          </Field>

          <Field label="Country / region" hint="Leave empty if you target cities instead.">
            <MultiSelect
              name="contact_location"
              options={LOCATIONS}
              placeholder="Search countries, regions, states…"
              emptyText="No location matches."
            />
          </Field>

          <Field label="Cities" hint="Use instead of country for city-level targeting.">
            <Textarea name="contact_city" rows={2} placeholder="stockholm, göteborg" />
          </Field>

          <Field label="Industries">
            <MultiSelect
              name="company_industry"
              options={INDUSTRIES}
              placeholder="Search Apify's industry list…"
              emptyText="No industry matches."
            />
          </Field>

          <Field label="Company keywords">
            <Textarea name="company_keywords" rows={2} placeholder="utbildning, konsult" />
          </Field>

          <Field label="Exclude keywords">
            <Textarea name="company_not_keywords" rows={2} />
          </Field>

          <Field label="Company size">
            <CheckGroup name="size" options={COMPANY_SIZE} />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Min revenue">
              <RevenueSelect name="min_revenue" />
            </Field>
            <Field label="Max revenue">
              <RevenueSelect name="max_revenue" />
            </Field>
          </div>

          <Field label="Email status">
            <CheckGroup name="email_status" options={EMAIL_STATUS} />
          </Field>

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.ok ? <p className="text-sm text-green-600 dark:text-green-400">{state.ok}</p> : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Starting…' : 'Start search'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
