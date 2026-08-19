'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Hint } from '@/components/hint'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const ANY = 'any'

/**
 * Targeting for enrollment: narrow to one search and a score floor, select all,
 * then enroll. Plain GET params so a useful slice is a shareable URL.
 */
export function LeadFilters({
  query,
  source,
  searches,
}: {
  query: string
  source: number | null
  searches: { id: number; label: string; leads: number }[]
}) {
  const router = useRouter()

  function apply(patch: Record<string, string | null>) {
    const params = new URLSearchParams()
    const next = {
      q: query || null,
      source: source ? String(source) : null,
      ...patch,
    }
    for (const [key, value] of Object.entries(next)) if (value) params.set(key, value)
    router.push(`/leads${params.size ? `?${params}` : ''}`)
  }

  return (
    <form
      className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const value = new FormData(event.currentTarget).get('q')
        apply({ q: String(value ?? '') || null })
      }}
    >
      <div className="space-y-1">
        <Label className="text-muted-foreground flex items-center gap-1 text-xs">
          Source search
          <Hint>
            Which Apify run a lead came from. Useful for spot-checking one batch — campaigns pick
            their own sources, so you rarely need to enrol by hand from here.
          </Hint>
        </Label>
        <Select
          value={source ? String(source) : ANY}
          onValueChange={(value) => apply({ source: value === ANY ? null : value })}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All searches</SelectItem>
            {searches.map((search) => (
              <SelectItem key={search.id} value={String(search.id)}>
                {search.label} ({search.leads})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="ml-auto flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Search</Label>
          <Input
            name="q"
            defaultValue={query}
            placeholder="Name, company, title…"
            className="w-64"
          />
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
      </div>
    </form>
  )
}
