'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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

export function SearchForm() {
  const [state, action, pending] = useActionState(createSearch, {})

  return (
    <Card className="h-fit lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="text-base">New search</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-5">
          <datalist id="industries">
            {INDUSTRIES.map((industry) => (
              <option key={industry} value={industry} />
            ))}
          </datalist>
          <datalist id="locations">
            {LOCATIONS.map((location) => (
              <option key={location} value={location} />
            ))}
          </datalist>

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

          <Field label="Country / region" hint="Pick from the list. Comma separated for several.">
            <Input name="contact_location" list="locations" placeholder="sweden" />
          </Field>

          <Field label="Cities" hint="Use instead of country for city-level targeting.">
            <Textarea name="contact_city" rows={2} placeholder="stockholm, göteborg" />
          </Field>

          <Field label="Industries" hint="Start typing to pick from Apify's list. Comma separated.">
            <Input
              name="company_industry"
              list="industries"
              placeholder="information technology & services"
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
              <select
                name="min_revenue"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                defaultValue=""
              >
                <option value="">Any</option>
                {REVENUE.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Max revenue">
              <select
                name="max_revenue"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                defaultValue=""
              >
                <option value="">Any</option>
                {REVENUE.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Email status">
            <CheckGroup name="email_status" options={EMAIL_STATUS} />
          </Field>

          {state.error ? <p className="text-destructive text-sm">{state.error}</p> : null}
          {state.ok ? <p className="text-sm text-green-600">{state.ok}</p> : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Starting…' : 'Start search'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
