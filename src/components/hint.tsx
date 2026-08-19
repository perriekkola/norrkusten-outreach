'use client'

import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Inline explainer for anything whose behaviour isn't obvious from its label.
 * The trigger is a real focusable button — type="button" matters, an unspecified
 * button inside a form submits it — so it opens on keyboard focus too, not just hover.
 */
export function Hint({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={label ?? 'More information'}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex align-middle transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}
