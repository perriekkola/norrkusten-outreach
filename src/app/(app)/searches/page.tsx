import { PageHeader } from '@/components/page-header'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cancelSearch, deleteSearch, refreshSearches } from '@/lib/actions'
import { db, type Search } from '@/lib/db'
import { ingestSearches } from '@/lib/engine'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { SearchForm } from './search-form'
import { SearchPoller } from './search-poller'

const STATUS_VARIANT = {
  running: 'secondary',
  ready: 'default',
  failed: 'destructive',
} as const

function summarise(input: Record<string, unknown>) {
  return Object.entries(input)
    .filter(([key]) => key !== 'file_name')
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' · ')
}

export const maxDuration = 300

export default async function SearchesPage() {
  // Pull in anything Apify finished since the last look, so the page never shows a
  // stale "running". Cheap: one status call per in-flight run, and a no-op if none.
  await ingestSearches().catch((error) => console.error('ingest on load failed', error))

  const searches = (await db()`select * from searches order by created_at desc limit 50`) as Search[]
  const running = searches.filter((search) => search.status === 'running').length

  return (
    <>
      <PageHeader
        title="Searches"
        description="Source leads from Apify. Runs finish in the background — results import automatically."
      >
        <form action={refreshSearches} className="flex items-center gap-1.5">
          <SubmitButton variant="outline" size="sm" pendingLabel="Checking…">
            Check for results
          </SubmitButton>
          <Hint>
            Asks Apify whether each running search has finished and imports the leads. This page
            already does it on load and every 15 seconds while a search is running, so you rarely
            need the button.
          </Hint>
        </form>
      </PageHeader>

      <SearchPoller running={running} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="pb-0">
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {searches.length === 0 ? (
              <p className="text-muted-foreground p-6 pt-0 text-sm">No searches yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Imported</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searches.map((search) => (
                    <TableRow key={search.id}>
                      <TableCell className="max-w-[420px]">
                        <div className="font-medium">{search.label}</div>
                        <div className="text-muted-foreground truncate text-xs">
                          {summarise(search.input)}
                        </div>
                        {search.error ? (
                          <div className="text-destructive mt-1 text-xs">{search.error}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[search.status] ?? 'secondary'}>
                          {search.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{search.imported}</TableCell>
                      <TableCell className="text-right">
                        {search.status === 'running' ? (
                          <ConfirmButton
                            action={cancelSearch}
                            payload={{ id: search.id }}
                            title="Cancel this search?"
                            description="Aborts the Apify run. Leads it already found are lost — Apify still bills for what it fetched."
                            confirmLabel="Cancel run"
                            pendingLabel="Cancelling…"
                          >
                            Cancel
                          </ConfirmButton>
                        ) : (
                          <ConfirmButton
                            action={deleteSearch}
                            payload={{ id: search.id }}
                            title="Delete this search?"
                            description="Removes the search record. The leads it imported stay, but they lose their source, so campaigns pulling from this search will no longer pick them up."
                            confirmLabel="Delete"
                            pendingLabel="Deleting…"
                          >
                            Delete
                          </ConfirmButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <SearchForm />
      </div>
    </>
  )
}
