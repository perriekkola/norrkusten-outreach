'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const count = (n: number) => n.toLocaleString('sv-SE')

/**
 * Paging for a list the database is holding back.
 *
 * The page number is typed, not just stepped. Sixteen pages of leads is nine clicks to
 * reach the middle and no way to say where you actually want to be, which is the whole
 * complaint about Previous/Next on its own.
 *
 * `href` is what the containing page thinks a given page's URL is — it carries the filters
 * and the sort along, so paging never quietly drops either.
 */
export function Pager({
  page,
  pages,
  total,
  shown,
  href,
}: {
  page: number
  pages: number
  total: number
  /** How many rows this page actually rendered, for the "1-100 of 1 560" line. */
  shown: number
  href: (page: number) => string
}) {
  const router = useRouter()
  const [typed, setTyped] = useState('')
  const first = (page - 1) * Math.max(shown, 1) + 1

  function go(raw: string) {
    const wanted = Number(raw)
    setTyped('')
    if (!Number.isFinite(wanted) || wanted < 1) return
    // Clamping rather than refusing: asking for page 40 of 16 means "the end".
    const target = Math.min(Math.max(Math.trunc(wanted), 1), pages)
    if (target !== page) router.push(href(target))
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-muted-foreground text-xs tabular-nums">
        {count(first)}–{count(first + shown - 1)} of {count(total)}
      </span>

      {pages > 1 ? (
        <div className="flex items-center gap-2">
          <Step to={page - 1} enabled={page > 1} href={href}>
            Previous
          </Step>

          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              go(typed)
            }}
          >
            <label htmlFor="pager" className="text-muted-foreground text-xs">
              Page
            </label>
            <Input
              id="pager"
              inputMode="numeric"
              className="h-8 w-16 text-center tabular-nums"
              value={typed}
              placeholder={String(page)}
              aria-label={`Page ${page} of ${pages} — type a page number`}
              onChange={(event) => setTyped(event.target.value.replace(/[^\d]/g, ''))}
              onBlur={() => typed && go(typed)}
            />
            <span className="text-muted-foreground text-xs tabular-nums">of {count(pages)}</span>
          </form>

          <Step to={page + 1} enabled={page < pages} href={href}>
            Next
          </Step>
        </div>
      ) : null}
    </div>
  )
}

/** `asChild` hands its props to a Link, and an anchor ignores `disabled` — so at either
 *  end of the range render a real button that is actually unclickable. */
function Step({
  to,
  enabled,
  href,
  children,
}: {
  to: number
  enabled: boolean
  href: (page: number) => string
  children: React.ReactNode
}) {
  if (!enabled) {
    return (
      <Button size="sm" variant="outline" disabled>
        {children}
      </Button>
    )
  }
  return (
    <Button size="sm" variant="outline" asChild>
      <Link href={href(to)}>{children}</Link>
    </Button>
  )
}
