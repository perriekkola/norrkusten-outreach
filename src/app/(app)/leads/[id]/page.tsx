import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmButton } from '@/components/confirm-button'
import { Hint } from '@/components/hint'
import { PageHeader } from '@/components/page-header'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { setLeadStatus, unenroll } from '@/lib/actions'
import { db, type Lead, type Message } from '@/lib/db'

type Enrollment = {
  id: number
  step: number
  status: string
  next_send_at: string
  score: number | null
  verdict: string | null
  reasons: string | null
  angle: string | null
  campaign_id: number
  campaign_name: string
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="min-w-0 break-words">{value || '—'}</span>
    </div>
  )
}

export default async function LeadPage({ params }: PageProps<'/leads/[id]'>) {
  const { id } = await params
  const [lead] = (await db()`select * from leads where id = ${Number(id)}`) as Lead[]
  if (!lead) notFound()

  const enrollments = (await db()`
    select e.id, e.step, e.status, e.next_send_at, e.score, e.verdict, e.reasons, e.angle,
           c.id as campaign_id, c.name as campaign_name
      from enrollments e join campaigns c on c.id = e.campaign_id
     where e.lead_id = ${lead.id} order by e.created_at desc`) as Enrollment[]

  const messages = (await db()`
    select * from messages where lead_id = ${lead.id} order by created_at`) as Message[]

  return (
    <>
      <PageHeader
        title={lead.full_name || lead.email}
        description={[lead.job_title, lead.company_name].filter(Boolean).join(' · ')}
      >
        <form action={setLeadStatus} className="flex shrink-0 items-center gap-1.5">
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="status" value="replied" />
          <SubmitButton size="sm" pendingLabel="…">
            Mark replied
          </SubmitButton>
          <Hint>
            Replies are detected automatically over IMAP. Use this when someone answers off-thread
            — from a different address, or by phone. It stops every sequence this lead is in.
          </Hint>
        </form>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {enrollments.some((e) => e.score !== null) ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Fit per campaign</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {enrollments
                  .filter((enrollment) => enrollment.score !== null)
                  .map((enrollment) => (
                    <div key={enrollment.id} className="rounded-lg border p-4">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <Link
                          href={`/campaigns/${enrollment.campaign_id}`}
                          className="text-sm font-medium hover:underline"
                        >
                          {enrollment.campaign_name}
                        </Link>
                        <Badge className="capitalize">
                          {enrollment.verdict} · {enrollment.score}
                        </Badge>
                      </div>
                      <p className="text-muted-foreground text-sm">{enrollment.reasons}</p>
                      <Separator className="my-3" />
                      <p className="text-sm">
                        <span className="text-muted-foreground">Angle: </span>
                        {enrollment.angle}
                      </p>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ) : null}

          {lead.research ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Company research</CardTitle>
                <CardDescription>
                  Gathered automatically the first time we wrote to this company.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{lead.research}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Messages</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {messages.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing drafted or sent yet.</p>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{message.subject}</span>
                      <Badge variant={message.status === 'sent' ? 'default' : 'secondary'}>
                        {message.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                      {message.body}
                    </p>
                    {message.error ? (
                      <p className="text-destructive mt-2 text-xs">{message.error}</p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              <Row label="Status" value={<span className="capitalize">{lead.status}</span>} />
              <Row label="Email" value={lead.email} />
              <Row label="Phone" value={lead.phone} />
              <Row
                label="LinkedIn"
                value={
                  lead.linkedin ? (
                    <a href={lead.linkedin} target="_blank" rel="noreferrer" className="underline">
                      Profile
                    </a>
                  ) : null
                }
              />
              <Row label="Location" value={[lead.city, lead.country].filter(Boolean).join(', ')} />
              <Row label="Company" value={lead.company_name} />
              <Row
                label="Website"
                value={
                  lead.company_website ? (
                    <a
                      href={lead.company_website}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {lead.company_domain ?? lead.company_website}
                    </a>
                  ) : (
                    lead.company_domain
                  )
                }
              />
              <Row label="Industry" value={lead.industry} />
              <Row label="Size" value={lead.company_size} />
              <Row label="About" value={lead.company_description} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Campaigns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {enrollments.length === 0 ? (
                <p className="text-muted-foreground text-sm">Not enrolled anywhere.</p>
              ) : (
                enrollments.map((enrollment) => (
                  <div key={enrollment.id} className="flex items-center justify-between gap-2">
                    <div className="text-sm">
                      <Link
                        href={`/campaigns/${enrollment.campaign_id}`}
                        className="font-medium hover:underline"
                      >
                        {enrollment.campaign_name}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {enrollment.score !== null ? `score ${enrollment.score} · ` : ''}
                        step {enrollment.step + 1} · {enrollment.status}
                      </div>
                    </div>
                    <ConfirmButton
                      action={unenroll}
                      payload={{ enrollmentId: enrollment.id }}
                      title="Remove from this campaign?"
                      description="The score, the angle and any unsent draft are deleted. The lead stays in the pool."
                      confirmLabel="Remove"
                      pendingLabel="Removing…"
                    >
                      Remove
                    </ConfirmButton>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
