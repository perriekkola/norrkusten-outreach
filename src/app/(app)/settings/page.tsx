import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db, getSetting } from '@/lib/db'
import { SettingsForm, UserForm } from './settings-form'

const KEYS = [
  { name: 'DATABASE_URL', what: 'Postgres (Neon)' },
  { name: 'ANTHROPIC_API_KEY', what: 'Claude — qualifying, research, drafting' },
  { name: 'APIFY_TOKEN', what: 'Apify — lead search' },
  { name: 'SMTP_HOST', what: 'Outgoing mail (one.com)' },
  { name: 'SMTP_USER', what: 'Mailbox address' },
  { name: 'SMTP_PASS', what: 'Mailbox password' },
  { name: 'FROM_EMAIL', what: 'From header' },
  { name: 'IMAP_HOST', what: 'Reply detection (optional)' },
  { name: 'APP_URL', what: 'Open tracking pixel (auto on Vercel)' },
  { name: 'AUTH_SECRET', what: 'Session signing' },
  { name: 'CRON_SECRET', what: 'Protects /api/cron' },
] as const

export default async function SettingsPage() {
  const senderName = await getSetting('sender_name')
  const users = (await db()`select id, email, created_at from users order by created_at`) as {
    id: number
    email: string
    created_at: string
  }[]

  return (
    <>
      <PageHeader title="Settings" />

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
