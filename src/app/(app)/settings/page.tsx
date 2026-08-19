import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db, getSetting } from '@/lib/db'
import { Mailboxes, type MailboxRow } from './mailboxes'
import { SettingsForm, UserForm } from './settings-form'

const KEYS = [
  { name: 'DATABASE_URL', what: 'Postgres (Neon)' },
  { name: 'ANTHROPIC_API_KEY', what: 'Claude — qualifying, research, drafting' },
  { name: 'APIFY_TOKEN', what: 'Apify — lead search' },
  { name: 'SMTP_HOST', what: 'Fallback only — used when no mailbox exists' },
  { name: 'SMTP_USER', what: 'Fallback only' },
  { name: 'SMTP_PASS', what: 'Fallback only' },
  { name: 'FROM_EMAIL', what: 'Fallback only' },
  { name: 'IMAP_HOST', what: 'Fallback only' },
  { name: 'APP_URL', what: 'Open tracking pixel (auto on Vercel)' },
  { name: 'AUTH_SECRET', what: 'Session signing and mailbox password encryption' },
  { name: 'CRON_SECRET', what: 'Protects /api/cron' },
] as const

export default async function SettingsPage() {
  const senderName = await getSetting('sender_name')
  // smtp_pass is deliberately not selected — the encrypted value never goes to the client.
  const mailboxes = (await db()`
    select id, name, from_email, reply_to, smtp_host, smtp_port, smtp_user,
           imap_host, imap_port, is_default
      from mailboxes order by is_default desc, id`) as MailboxRow[]

  const users = (await db()`select id, email, created_at from users order by created_at`) as {
    id: number
    email: string
    created_at: string
  }[]

  return (
    <>
      <PageHeader title="Settings" />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Mailboxes</CardTitle>
          <CardDescription>
            Sending identities. Each campaign chooses one, so outreach can come from whoever owns
            the relationship rather than a single shared address.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Mailboxes mailboxes={mailboxes} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sending identity</CardTitle>
            <CardDescription>
              Who signs the emails. Each campaign carries its own targeting profile — set that on
              the campaign itself.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm senderName={senderName} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Environment</CardTitle>
              <CardDescription>
                Set these in Vercel → Project → Settings → Environment Variables (or{' '}
                <code>.env.local</code> locally).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {KEYS.map((key) => (
                <div key={key.name} className="flex items-center justify-between gap-3 py-1 text-sm">
                  <div className="min-w-0">
                    <code className="text-xs">{key.name}</code>
                    <div className="text-muted-foreground text-xs">{key.what}</div>
                  </div>
                  <Badge variant={process.env[key.name] ? 'default' : 'outline'}>
                    {process.env[key.name] ? 'set' : 'missing'}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admin users</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1 text-sm">
                {users.map((user) => (
                  <li key={user.id} className="text-muted-foreground">
                    {user.email}
                  </li>
                ))}
              </ul>
              <UserForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
