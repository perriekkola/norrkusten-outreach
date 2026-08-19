# Norrkusten Outreach

Finds leads, qualifies them with Claude, writes the emails, sends them from your own
one.com mailbox and tracks what comes back. Next.js 16 + shadcn/ui on Vercel, Neon Postgres,
no third-party sending service.

## How it works

```
Apify search  →  leads  →  Claude qualify + research  →  campaign  →  outbox  →  SMTP
                                                                        ↑            ↓
                                                              you approve      IMAP reply check
```

| Page | What it does |
|---|---|
| **Searches** | Runs the `code_crafter/leads-finder` Apify actor with your filters. Results import automatically. |
| **Leads** | Select rows → qualify against your ICP (0–100 score + angle), research the company via Claude's web search, enroll in a campaign. |
| **Campaigns** | A sequence of *goals*, not templates. Claude writes each email per lead from the offer, the research and the thread so far. |
| **Outbox** | Every draft waits for approval (unless the campaign has auto-send on). Edit, approve, send now or discard. |
| **Analytics** | Funnel, 30-day activity, per-campaign open and reply rates. |
| **Settings** | Your ICP text, sender name, admin users, and which env vars are set. |

An hourly cron (`/api/cron`) imports finished searches, checks IMAP for replies, drafts what is
due and sends what is approved. Every button also has a manual equivalent in the UI.

## Setup

### 1. Database

Create a free Neon Postgres from the Vercel dashboard (Storage → Neon) or:

```bash
vercel link
vercel integration add neon
vercel env pull .env.local
```

Then apply the schema:

```bash
npm run db:push
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in. In production set the same in
Vercel → Settings → Environment Variables.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | From Neon |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `APIFY_TOKEN` | apify.com → Settings → API tokens |
| `SMTP_HOST` / `SMTP_PORT` | one.com: `send.one.com`, `465` |
| `SMTP_USER` / `SMTP_PASS` | Full mailbox address + its password |
| `FROM_EMAIL` | `Ditt Namn <hej@dindoman.se>` |
| `REPLY_TO_EMAIL` | Optional |
| `IMAP_HOST` / `IMAP_PORT` | one.com: `imap.one.com`, `993`. Falls back to the SMTP credentials for user/pass. Leave `IMAP_HOST` empty to disable reply detection. |
| `APP_URL` | Public URL, for the open-tracking pixel. Auto-detected on Vercel. |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `CRON_SECRET` | `openssl rand -base64 32` |

### 3. First run

```bash
npm run dev
```

Open `/login`. With no users in the database the form creates the admin account — the
first email and password you enter become the login. Add more people later under Settings.

Then fill in **Settings → Ideal customer profile**. Lead qualification does nothing without it.

### 4. Deploy

```bash
vercel deploy --prod
```

The cron in `vercel.json` runs hourly. On the Hobby plan Vercel only runs crons once a day —
either upgrade to Pro or use the "Run pipeline now" button on the dashboard.

## Analytics: what the numbers mean

- **Opens** come from a 1×1 tracking pixel. Apple Mail Privacy Protection and Gmail's image
  proxy pre-load images, so opens are inflated. Read the trend, not the count.
- **Replies** are matched over IMAP against the real `In-Reply-To` / `References` headers, so
  they are exact. A reply immediately stops that lead's sequence and marks the lead `replied`.
- **Bounces** land in your inbox as normal mail — plain SMTP has no bounce webhook. Mark those
  leads rejected by hand.

## Sending volume

You are sending from a normal one.com mailbox, not a bulk provider. Keep daily volume modest
(low hundreds at most), make sure SPF/DKIM are set up for the domain, and expect deliverability
to depend on your domain reputation. The sender is rate-limited to 2 messages/second.

## Development

```bash
npm run dev       # dev server
npm test          # schema + query + security self-check (PGlite, no server needed)
npm run build     # production build
npm run db:push   # apply schema.sql (idempotent)
```

`npm test` applies the real `schema.sql` to an in-process Postgres and runs the queries
whose SQL is easiest to get wrong, plus the tracking-token and HTML-escaping checks.

## Deliberate simplifications

- No queue: bulk AI actions run inside the request with bounded concurrency and a per-click
  cap (40 qualify / 15 research). Move to a queue if you routinely process thousands.
- No unsubscribe link. Add one before sending at volume — it is required for marketing email
  to consumers under GDPR/ePrivacy, and good practice for B2B.
- Light theme only.
