import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/page-header'
import { SubmitButton } from '@/components/submit-button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { qualifyLeads, researchLeads, setLeadStatus, unenroll } from '@/lib/actions'
import { db, type Lead, type Message } from '@/lib/db'

type Enrollment = {
  id: number
  step: number
  status: string
  next_send_at: string
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
    select e.id, e.step, e.status, e.next_send_at, c.id as campaign_id, c.name as campaign_name
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
        <form action={qualifyLeads}>
          <input type="hidden" name="leadId" value={lead.id} />
          <SubmitButton size="sm" variant="outline" pendingLabel="Qualifying…">
            Qualify
          </SubmitButton>
        </form>
        <form action={researchLeads}>
          <input type="hidden" name="leadId" value={lead.id} />
          <SubmitButton size="sm" variant="outline" pendingLabel="Researching…">
            Research
          </SubmitButton>
        </form>
        <form action={setLeadStatus}>
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="status" value="replied" />
          <SubmitButton size="sm" pendingLabel="…">
            Mark replied
          </SubmitButton>
        </form>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {lead.score !== null ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">Qualification</CardTitle>
                <Badge className="capitalize">
                  {lead.verdict} · {lead.score}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{lead.reasons}</p>
                <Separator />
                <p>
                  <span className="text-muted-foreground">Angle: </span>
                  {lead.angle}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {lead.research ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Company research</CardTitle>
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
                        step {enrollment.step + 1} · {enrollment.status} · next{' '}
                        {new Date(enrollment.next_send_at).toLocaleDateString('sv-SE')}
                      </div>
                    </div>
                    <form action={unenroll}>
                      <input type="hidden" name="enrollmentId" value={enrollment.id} />
                      <SubmitButton size="sm" variant="ghost" pendingLabel="…">
                        Remove
                      </SubmitButton>
                    </form>
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
