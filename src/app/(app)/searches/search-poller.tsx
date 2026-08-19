'use client'

import { useEffect } from 'react'
import { refreshSearches } from '@/lib/actions'

/**
 * Apify runs finish out of band, so a page that only checks on load shows a stale
 * "running" until you press something. While anything is in flight, poll.
 */
export function SearchPoller({ running }: { running: number }) {
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void refreshSearches()
    }, 15_000)
    return () => clearInterval(timer)
  }, [running])

  return null
}
