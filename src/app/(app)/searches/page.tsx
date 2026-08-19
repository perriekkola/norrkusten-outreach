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
import { SearchForm } from './search-form'

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

export default async function SearchesPage() {
  const searches = (await db()`select * from searches order by created_at desc limit 50`) as Search[]

  return (
    <>
      <PageHeader
        title="Searches"
        description="Source leads from Apify. Runs finish in the background — results import automatically."
      >
        <form action={refreshSearches}>
          <SubmitButton variant="outline" size="sm" pendingLabel="Checking…">
            Check for results
          </SubmitButton>
        </form>
      </PageHeader>

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
                        <form
                          action={search.status === 'running' ? cancelSearch : deleteSearch}
                          className="inline"
                        >
                          <input type="hidden" name="id" value={search.id} />
                          <SubmitButton variant="ghost" size="sm" pendingLabel="…">
                            {search.status === 'running' ? 'Cancel' : 'Delete'}
                          </SubmitButton>
                        </form>
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
