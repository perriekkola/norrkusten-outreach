'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'

/**
 * Tabs that live in the URL.
 *
 * A plain <Tabs> forgets which one you were on the moment anything reloads, and these
 * pages reload constantly: approving an email, marking a reply and paging the enrolled
 * list all refresh the page. Landing back on the first tab every time is the kind of small
 * tax that makes a tool tiring to use, and it also means a tab cannot be linked to.
 *
 * The URL is written with the history API rather than `router.replace`, because every
 * tab's content is already on the page — the server renders all of them into <TabsContent>
 * and no page reads the parameter back. `router.replace` sent the whole page to the server
 * again for that, so switching to a tab already sitting in the DOM re-ran the outbox's
 * three thousand rows of queries and, now that there is a loading skeleton, blanked the
 * page while it waited. `replaceState` still syncs `useSearchParams`, so the tab survives
 * a refresh exactly as before, and it does not fill the back button either.
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
        window.history.replaceState(null, '', `${pathname}${query.size ? `?${query}` : ''}`)
      }}
    >
      {children}
    </Tabs>
  )
}
