import { cn } from '@/lib/utils'

/**
 * Shown the instant a link is clicked, for every page in the app.
 *
 * Without a loading boundary Next.js keeps the old page on screen until the new one has
 * finished rendering on the server, and every page here waits on the database first — the
 * outbox alone runs five queries over three lists. The click looked ignored for as long as
 * that took. It also gives <Link> something to prefetch: a dynamic route with no loading
 * boundary prefetches nothing, so the wait started from scratch on every click.
 *
 * One skeleton for all eight pages rather than one per route. They are all a header over a
 * card of rows, and the job here is "it heard you", not a pixel-accurate ghost of the page
 * that is about to arrive.
 */
export default function Loading() {
  return (
    <div role="status" aria-busy>
      <span className="sr-only">Loading…</span>

      <div className="mb-6 space-y-2.5">
        <Bar className="h-7 w-40" />
        <Bar className="h-4 w-full max-w-lg" />
      </div>

      <div className="bg-card ring-foreground/10 space-y-3 rounded-xl p-4 ring-1">
        {/* Widths vary down the list so it reads as rows of text rather than a bar chart. */}
        {[...Array(8)].map((_, row) => (
          <div key={row} className="flex items-center gap-4">
            <Bar className="h-4 flex-1" />
            <Bar className="hidden h-4 w-1/5 sm:block" />
            <Bar className="hidden h-4 w-1/6 md:block" />
            <Bar className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Bar({ className }: { className?: string }) {
  return <div className={cn('bg-muted animate-pulse rounded', className)} />
}
