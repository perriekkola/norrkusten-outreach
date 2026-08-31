import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { SubmitButton } from '@/components/submit-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { UrlTabs } from '@/components/url-tabs'
import { deleteCampaign, dropWeak, setCampaignStatus } from '@/lib/actions'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { RunButton } from './run-button'
import { EnrollmentsTable, type EnrollmentRow, type EnrollmentSortKey } from './enrollments-table'
import { orderBy, sortFromParams } from '@/lib/sort'
import { UNIT, campaignCost, usd } from '@/lib/costs'
import { db, type Campaign } from '@/lib/db'
import { ReviseCampaign } from './revise-campaign'

/** Sortable columns and the SQL each means. `sent` and `opened` are output columns. */
const ENROLLMENT_SORTS = {
  lead: 'l.full_name',
  company: 'l.company_name',
  score: 'e.score',
  step: 'e.step',
  sent: 'sent',
  opened: 'opened',
  status: 'e.status',
  next: 'e.next_send_at',
} as const

const ENROLLED_PER_PAGE = 100

export const maxDuration = 300

export async function generateMetadata({ params }: PageProps<'/campaigns/[id]'>) {
  const { id } = await params
  const [campaign] = (await db()`
    select name from campaigns where id = ${Number(id)}`) as Campaign[]
  return { title: campaign?.name ?? 'Campaign' }
}

export default async function CampaignPage({ params, searchParams }: PageProps<'/campaigns/[id]'>) {
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

  const query = await searchParams
  const page = Math.max(1, Number(query.page) || 1)
  const sort = sortFromParams(query, Object.keys(ENROLLMENT_SORTS) as EnrollmentSortKey[])

  // 'removed' rows are hidden, not gone. They exist only to stop the campaign re-enrolling
  // someone who was deliberately taken out, so showing them would be showing plumbing.
  const VISIBLE = `e.campaign_id = $1 and e.status <> 'removed'`

  const [enrollments, [counts]] = (await Promise.all([
    db().query(
      `select e.id, e.step, e.status, e.next_send_at, e.score, e.verdict, e.reasons,
              l.id as lead_id, l.full_name, l.email, l.company_name,
              (select count(*) from messages m
                where m.enrollment_id = e.id and m.status = 'sent')::int as sent,
              (select count(*) from messages m
                where m.enrollment_id = e.id and m.opened_at is not null)::int as opened
         from enrollments e join leads l on l.id = e.lead_id
        where ${VISIBLE}
        order by ${orderBy(ENROLLMENT_SORTS, sort, 'e.score desc nulls last, e.next_send_at')}
        limit $2 offset $3`,
      [campaign.id, ENROLLED_PER_PAGE, (page - 1) * ENROLLED_PER_PAGE],
    ),
    // Counted, not derived from the page: a campaign with 900 enrollments would otherwise
    // report whatever happened to fit on screen, and the Drop button would undercount.
    db().query(
      `select count(*)::int as total,
              count(*) filter (where e.score is null)::int as unscored,
              count(*) filter (where e.score is not null and e.score < $2)::int as below
         from enrollments e where ${VISIBLE}`,
      [campaign.id, campaign.min_score],
    ),
  ])) as [EnrollmentRow[], { total: number; unscored: number; below: number }[]]

  const unscored = counts.unscored
  const belowFloor = counts.below

  // What pressing Run now would spend. Research is counted only for leads whose company
  // has never been researched — it is paid once and reused by every later email and every
  // other campaign, so counting it per due lead would roughly double the estimate.
  const [work] = (await db()`
    select
      (select count(*) from enrollments
        where campaign_id = ${campaign.id} and score is null
          and status <> 'removed')::int as to_score,
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

  // A fixed campaign writes nothing and researches nothing, so a pass only ever pays to
  // score. Quoting the drafting cost anyway would be quoting for work that never happens.
  const fixed = campaign.writing_mode === 'fixed'
  const estimate = campaignCost({
    toScore: work.to_score,
    toResearch: fixed ? 0 : work.to_research,
    toDraft: fixed ? 0 : work.to_draft,
  })

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={`${campaign.steps.length} steps · ${fixed ? 'fixed email' : 'written per lead'} · floor ${campaign.min_score} · ${unscored} unscored · ${belowFloor} below floor${campaign.auto_send ? ' · auto-send on' : ''}`}
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
            {fixed ? (
              <>
                What one press costs: {work.to_score} to score at about {usd(UNIT.qualify)}
                each. This campaign sends a fixed email, so nothing is researched and nothing
                is written. Once everyone is scored, pressing it is free.
              </>
            ) : (
              <>
                What one press costs: {work.to_score} to score at about {usd(UNIT.qualify)}{' '}
                each, {work.to_research} companies to research at about {usd(UNIT.research)},
                and {work.to_draft} emails to write at about {usd(UNIT.draft)}. Research is
                paid once per company and reused by every later email and every other
                campaign, so going over the same leads again costs far less. One press writes
                at most 25 emails, so a big backlog takes several.
              </>
            )}
          </Hint>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ConfirmButton
            action={dropWeak}
            payload={{ campaignId: campaign.id }}
            disabled={belowFloor === 0}
            title={`Remove ${belowFloor} low-scoring lead${belowFloor === 1 ? '' : 's'}?`}
            description={`Enrollments scoring under ${campaign.min_score} drop out of this campaign and the campaign will not pull them back in from its source searches. The leads themselves stay in the pool, and anyone already emailed is kept.`}
            confirmLabel="Remove"
            pendingLabel="Removing…"
          >
            {belowFloor === 0
              ? `Nobody below ${campaign.min_score}`
              : `Drop ${belowFloor} below ${campaign.min_score}`}
          </ConfirmButton>
          <Hint>
            Drops everyone scoring under this campaign&apos;s minimum so they stop cluttering
            the list, and stops the campaign pulling them back in. Anyone already emailed
            stays. Raise the minimum above if you want to cut deeper.
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

      <UrlTabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Enrolled ({counts.total})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="mt-4">
          {counts.total === 0 ? (
            <Card className="py-0">
              <CardContent className="p-8">
                <p className="text-muted-foreground text-center text-sm">
                  Nobody enrolled yet — filter by source search on the{' '}
                  <Link href="/leads" className="text-primary underline">
                    Leads
                  </Link>{' '}
                  page.
                </p>
              </CardContent>
            </Card>
          ) : (
            <EnrollmentsTable
              rows={enrollments}
              campaignId={campaign.id}
              minScore={campaign.min_score}
              stepCount={campaign.steps.length}
              total={counts.total}
              page={page}
              perPage={ENROLLED_PER_PAGE}
              sort={sort}
            />
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-8">
          <ReviseCampaign campaign={campaign} searches={searches} mailboxes={mailboxes} />
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
                description={`This removes the campaign, all ${counts.total} enrollments with their scores, and every draft. Emails already sent stay on the leads. The leads themselves are not touched. This cannot be undone.`}
                confirmLabel="Delete campaign"
                pendingLabel="Deleting…"
              >
                Delete campaign and its enrollments
              </ConfirmButton>
            </CardContent>
          </Card>
        </TabsContent>
      </UrlTabs>
    </>
  )
}
