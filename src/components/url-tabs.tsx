'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'

/**
 * Tabs that live in the URL.
 *
 * A plain <Tabs> forgets which one you were on the moment anything reloads, and these
 * pages reload constantly: approving an email, marking a reply and paging the enrolled
 * list all refresh the page. Landing back on the first tab every time is the kind of small
 * tax that makes a tool tiring to use, and it also means a tab cannot be linked to.
 *
 * `replace` rather than `push` so switching tabs does not fill up the back button, and
 * `scroll: false` so the page does not jump to the top on the way.
 */
export function UrlTabs({
  defaultValue,
  param = 'tab',
  className,
  children,
}: {
  defaultValue: string
  /** Name of the query parameter, in case a page ever needs two sets of tabs. */
  param?: string
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const value = params.get(param) ?? defaultValue

  return (
    <Tabs
      value={value}
      className={className}
      onValueChange={(next) => {
        const query = new URLSearchParams(params)
        // The default tab needs no parameter, which keeps shared links tidy and stops
        // "?tab=" appearing the first time somebody clicks anything.
        if (next === defaultValue) query.delete(param)
        else query.set(param, next)
        router.replace(`${pathname}${query.size ? `?${query}` : ''}`, { scroll: false })
      }}
    >
      {children}
    </Tabs>
  )
}
