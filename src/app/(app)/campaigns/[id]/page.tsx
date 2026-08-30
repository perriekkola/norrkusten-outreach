import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { deleteCampaign, dropWeak, setCampaignStatus, unenroll } from '@/lib/actions'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { RunButton } from './run-button'
import { UNIT, campaignCost, usd } from '@/lib/costs'
import { db, type Campaign } from '@/lib/db'
import { CampaignForm } from '../campaign-form'

type EnrollmentRow = {
  id: number
  step: number
  status: string
  next_send_at: string
  score: number | null
  verdict: string | null
  reasons: string | null
  lead_id: number
  full_name: string | null
  email: string
  company_name: string | null
  sent: number
  opened: number
}

const VERDICT_COLOR: Record<string, string> = {
  strong: 'bg-green-500/15 text-green-700 dark:text-green-400',
  medium: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  weak: 'bg-muted text-muted-foreground',
}

export const maxDuration = 300

export async function generateMetadata({ params }: PageProps<'/campaigns/[id]'>) {
  const { id } = await params
  const [campaign] = (await db()`
    select name from campaigns where id = ${Number(id)}`) as Campaign[]
  return { title: campaign?.name ?? 'Campaign' }
}

export default async function CampaignPage({ params }: PageProps<'/campaigns/[id]'>) {
  const { id } = await params
  const [campaign] = (await db()`select * from campaigns where id = ${Number(id)}`) as Campaign[]
  if (!campaign) notFound()

  const searches = (await db()`
    select s.id, s.label, count(l.id)::int as leads
      from searches s left join leads l on l.search_id = s.id
     group by s.id, s.label having count(l.id) > 0
     order by s.created_at desc`) as { id: number; label: string; leads: number }[]

  const mailboxes = (await db()`
    select id, name, from_email, is_default from mailboxes order by is_default desc, id`) as {
    id: number
    name: string
    from_email: string
    is_default: boolean
  }[]

  const enrollments = (await db()`
    select e.id, e.step, e.status, e.next_send_at, e.score, e.verdict, e.reasons,
           l.id as lead_id, l.full_name, l.email, l.company_name,
           (select count(*) from messages m
             where m.enrollment_id = e.id and m.status = 'sent')::int as sent,
           (select count(*) from messages m
             where m.enrollment_id = e.id and m.opened_at is not null)::int as opened
      from enrollments e join leads l on l.id = e.lead_id
     where e.campaign_id = ${campaign.id}
     order by e.score desc nulls last, e.next_send_at limit 500`) as EnrollmentRow[]

  const unscored = enrollments.filter((row) => row.score === null).length
  const belowFloor = enrollments.filter(
    (row) => row.score !== null && row.score < campaign.min_score,
  ).length

  // What pressing Run now would spend. Research is counted only for leads whose company
  // has never been researched — it is paid once and reused by every later email and every
  // other campaign, so counting it per due lead would roughly double the estimate.
  const [work] = (await db()`
    select
      (select count(*) from enrollments
        where campaign_id = ${campaign.id} and score is null)::int as to_score,
      (select count(*) from enrollments e join leads l on l.id = e.lead_id
        where e.campaign_id = ${campaign.id} and e.status = 'active'
          and e.next_send_at <= now() and e.score >= ${campaign.min_score}::int
          and l.research is null)::int as to_research,
      (select count(*) from enrollments e
        where e.campaign_id = ${campaign.id} and e.status = 'active'
          and e.next_send_at <= now() and e.score >= ${campaign.min_score}::int
          and not exists (select 1 from messages m
                           where m.enrollment_id = e.id and m.step = e.step))::int as to_draft
  `) as { to_score: number; to_research: number; to_draft: number }[]

  const estimate = campaignCost({
    toScore: work.to_score,
    toResearch: work.to_research,
    toDraft: work.to_draft,
  })

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${campaign.steps.length} steps · floor ${campaign.min_score} · ${unscored} unscored · ${belowFloor} below floor${campaign.auto_send ? ' · auto-send on' : ''}`}
      >
        <div className="flex shrink-0 items-center gap-1.5">
          <RunButton
            campaignId={campaign.id}
            blocked={
              campaign.icp.trim()
                ? undefined
                : 'Nothing to score against — fill in “Who this campaign targets” under Settings.'
            }
          />
          <span className="text-muted-foreground text-xs tabular-nums">≈{usd(estimate)}</span>
          <Hint>
            Estimated Claude spend for one pass: {work.to_score} to score at ≈{usd(UNIT.qualify)},{' '}
            {work.to_research} companies to research at ≈{usd(UNIT.research)}, {work.to_draft}{' '}
            emails to write at ≈{usd(UNIT.draft)}. Research is charged once per company and
            then reused by every later email and every other campaign, so a second pass over
            the same leads costs far less. A pass is capped at 25 drafts, so a large backlog
            takes several — the figure is for this pass.
          </Hint>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ConfirmButton
            action={dropWeak}
            payload={{ campaignId: campaign.id }}
            disabled={belowFloor === 0}
            title={`Remove ${belowFloor} low-scoring lead${belowFloor === 1 ? '' : 's'}?`}
            description={`Enrollments scoring under ${campaign.min_score} are removed from this campaign. The leads themselves stay in the pool, and anyone already emailed is kept.`}
            confirmLabel="Remove"
            pendingLabel="Removing…"
          >
            {belowFloor === 0
              ? `Nobody below ${campaign.min_score}`
              : `Drop ${belowFloor} below ${campaign.min_score}`}
          </ConfirmButton>
          <Hint>
            Permanently removes enrollments scoring under the campaign&apos;s minimum, so they
            stop cluttering the list. Anyone already emailed is kept. Raise the minimum in
            Settings if you want to cut more.
          </Hint>
        </div>
        <form action={setCampaignStatus} className="shrink-0">
          <input type="hidden" name="id" value={campaign.id} />
          <input
            type="hidden"
            name="status"
            value={campaign.status === 'active' ? 'paused' : 'active'}
          />
          <SubmitButton size="sm" variant="outline" pendingLabel="…">
            {campaign.status === 'active' ? 'Pause' : 'Resume'}
          </SubmitButton>
        </form>
      </PageHeader>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Enrolled ({enrollments.length})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          <Card className="py-0">
            <CardContent className="p-0">
              {enrollments.length === 0 ? (
                <p className="text-muted-foreground p-8 text-center text-sm">
                  Nobody enrolled yet — filter by source search on the{' '}
                  <Link href="/leads" className="text-primary underline">
                    Leads
                  </Link>{' '}
                  page.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead className="w-24 text-right">Score</TableHead>
                      <TableHead className="w-20">Step</TableHead>
                      <TableHead className="w-24">Sent</TableHead>
                      <TableHead className="w-24">Opened</TableHead>
                      <TableHead className="w-28">Status</TableHead>
                      <TableHead className="w-32">Next</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollments.map((row) => (
                      <TableRow
                        key={row.id}
                        className={
                          row.score !== null && row.score < campaign.min_score ? 'opacity-45' : ''
                        }
                      >
                        <TableCell>
                          <Link href={`/leads/${row.lead_id}`} className="font-medium hover:underline">
                            {row.full_name || row.email}
                          </Link>
                          <div className="text-muted-foreground text-xs">
                            {row.company_name ?? row.email}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.score === null ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            <span
                              title={row.reasons ?? ''}
                              className={`rounded px-2 py-0.5 text-sm font-medium tabular-nums ${
                                VERDICT_COLOR[row.verdict ?? ''] ?? ''
                              }`}
                            >
                              {row.score}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {Math.min(row.step + 1, campaign.steps.length)}/{campaign.steps.length}
                        </TableCell>
                        <TableCell className="tabular-nums">{row.sent}</TableCell>
                        <TableCell className="tabular-nums">{row.opened}</TableCell>
                        <TableCell>
                          <Badge variant={row.status === 'replied' ? 'default' : 'outline'}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {row.status === 'active'
                            ? new Date(row.next_send_at).toLocaleDateString('sv-SE')
                            : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <ConfirmButton
                            action={unenroll}
                            payload={{ enrollmentId: row.id }}
                            title="Remove this lead from the campaign?"
                            description="The score, the angle and any unsent draft are deleted. The lead stays in the pool and can be enrolled again, but it would be scored from scratch."
                            confirmLabel="Remove"
                            pendingLabel="Removing…"
                          >
                            Remove
                          </ConfirmButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-8">
          <CampaignForm campaign={campaign} searches={searches} mailboxes={mailboxes} />
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive text-base">Danger zone</CardTitle>
            </CardHeader>
            <CardContent>
              <ConfirmButton
                action={deleteCampaign}
                payload={{ id: campaign.id }}
                variant="destructive"
                title={`Delete "${campaign.name}"?`}
                description={`This removes the campaign, all ${enrollments.length} enrollments with their scores, and every draft. Emails already sent stay on the leads. The leads themselves are not touched. This cannot be undone.`}
                confirmLabel="Delete campaign"
                pendingLabel="Deleting…"
              >
                Delete campaign and its enrollments
              </ConfirmButton>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}
