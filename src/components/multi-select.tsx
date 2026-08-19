'use client'

import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Searchable multi-select over a fixed option list (Apify enums run to 1857 entries,
 * so the list has to be virtual-ish and searchable, not a native datalist).
 * Submits one hidden input per selected value, so the server action reads it as
 * a plain repeated form field.
 */
export function MultiSelect({
  name,
  options,
  placeholder = 'Select…',
  emptyText = 'No match.',
}: {
  name: string
  options: readonly string[]
  placeholder?: string
  emptyText?: string
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const toggle = (value: string) =>
    setSelected((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    )

  // Rendering 1857 CommandItems is slow; the list is only useful once filtered anyway.
  const visible = query
    ? options.filter((o) => o.includes(query.toLowerCase())).slice(0, 100)
    : options.slice(0, 100)

  return (
    <div className="space-y-2">
      {selected.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', !selected.length && 'text-muted-foreground')}>
              {selected.length ? `${selected.length} selected` : placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search…" value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {visible.map((option) => (
                  <CommandItem key={option} value={option} onSelect={() => toggle(option)}>
                    <Check
                      className={cn(
                        'mr-2 size-4',
                        selected.includes(option) ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    {option}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {selected.map((value) => (
            <Badge key={value} variant="secondary" className="gap-1 pr-1 font-normal">
              {value}
              <button
                type="button"
                onClick={() => toggle(value)}
                aria-label={`Remove ${value}`}
                className="hover:bg-background/60 rounded-sm p-0.5"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
