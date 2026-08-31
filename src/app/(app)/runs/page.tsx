import { PageHeader } from '@/components/page-header'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/lib/db'
import { roundsPerDay } from '@/lib/engine'
import { RunsTable, type Run } from './runs-table'

export const metadata = { title: 'Runs' }

export default async function RunsPage() {
  const [rows, rounds] = await Promise.all([
    db()`select id, started_at, finished_at, ok, result, error
           from runs order by started_at desc limit 100`,
    roundsPerDay(),
  ])
  const runs = rows as Run[]

  const failed = runs.filter((run) => run.ok === false).length
  const throttled = runs.filter((run) => run.result?.throttled).length

  return (
    <>
      <PageHeader
        title="Runs"
        description={`What the site did each time it ran on its own. ${rounds} rounds a day.`}
      />

      {failed || throttled ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/10 py-0">
          <CardContent className="p-3 text-xs leading-relaxed">
            {failed ? (
              <>
                <strong>
                  {failed} of the last {runs.length} rounds stopped with an error.
                </strong>{' '}
                The reason is on the row. Rounds are safe to fail: nothing is lost and the
                next one picks up where this one stopped.{' '}
              </>
            ) : null}
            {throttled ? (
              <>
                {failed ? '' : <strong>The mail server has been asking us to slow down. </strong>}
                {throttled} of these rounds were told to slow down. If that keeps happening,
                raise the seconds between emails in Settings.
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <RunsTable runs={runs} />
    </>
  )
}
