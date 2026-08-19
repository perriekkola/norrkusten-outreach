'use client'

import { CalendarIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ALL = 'all'
const PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: ALL, label: 'All time' },
]

const iso = (date: Date) => date.toISOString().slice(0, 10)
const fmt = (value: string) =>
  new Date(value).toLocaleDateString('sv-SE', { month: 'short', day: 'numeric' })

export function AnalyticsFilters({
  campaign,
  from,
  to,
  campaigns,
}: {
  campaign: number | null
  from: string
  to: string
  campaigns: { id: number; name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(
    from && to ? { from: new Date(from), to: new Date(to) } : undefined,
  )

  function apply(patch: Record<string, string | null>) {
    const params = new URLSearchParams()
    const next = { campaign: campaign ? String(campaign) : null, from, to, ...patch }
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value)
    router.push(`/analytics${params.size ? `?${params}` : ''}`)
  }

  /** Presets rewrite the explicit range, so the two controls never disagree. */
  function applyPreset(value: string) {
    if (value === ALL) return apply({ from: null, to: null })
    const start = new Date()
    start.setDate(start.getDate() - Number(value) + 1)
    apply({ from: iso(start), to: iso(new Date()) })
  }

  const days =
    from && to
      ? String(Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1)
      : ALL
  const preset = PRESETS.some((p) => p.value === days) ? days : 'custom'

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <Select
        value={campaign ? String(campaign) : ALL}
        onValueChange={(value) => apply({ campaign: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-60">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All campaigns</SelectItem>
          {campaigns.map((item) => (
            <SelectItem key={item.id} value={String(item.id)}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={preset} onValueChange={applyPreset}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Custom range" />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {preset === 'custom' ? <SelectItem value="custom">Custom range</SelectItem> : null}
        </SelectContent>
      </Select>

      <Popover
        open={open}
        onOpenChange={(next) => {
          // Reset the working range to whatever is applied whenever it reopens, so an
          // abandoned half-selection doesn't linger.
          if (next) setDraft(from && to ? { from: new Date(from), to: new Date(to) } : undefined)
          setOpen(next)
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" className="font-normal">
            <CalendarIcon className="mr-2 size-4 opacity-60" />
            {from && to ? `${fmt(from)} – ${fmt(to)}` : 'Pick dates'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {/* Uncontrolled while open: the range is only pushed to the URL on Apply, so
              picking a start date doesn't reload the page with half a range. */}
          <Calendar
            mode="range"
            numberOfMonths={2}
            defaultMonth={draft?.from ?? (from ? new Date(from) : undefined)}
            selected={draft}
            onSelect={setDraft}
          />
          <div className="flex items-center justify-between gap-2 border-t p-3">
            <span className="text-muted-foreground text-xs">
              {draft?.from && draft.to
                ? `${fmt(iso(draft.from))} – ${fmt(iso(draft.to))}`
                : draft?.from
                  ? 'Now pick an end date'
                  : 'Pick a start date'}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(undefined)
                  setOpen(false)
                  apply({ from: null, to: null })
                }}
              >
                Clear
              </Button>
              <Button
                size="sm"
                disabled={!draft?.from || !draft?.to}
                onClick={() => {
                  if (!draft?.from || !draft.to) return
                  setOpen(false)
                  apply({ from: iso(draft.from), to: iso(draft.to) })
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
