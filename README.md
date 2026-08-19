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
| **Leads** | The raw pool. Filter by source search, enroll into a campaign, set status. |
| **Campaigns** | The workspace. A campaign names the searches it pulls leads from, its own ICP, a score floor, the offer and the sequence. **Run now** does the whole chain in one pass — enrol, score against *this* campaign's ICP, draft what is due, best-scoring first. Safe to repeat; every stage skips work already done. |
| **Outbox** | Every draft waits for approval (unless the campaign has auto-send on). Edit, approve, send now or discard. |
| **Analytics** | Funnel, activity over any date range, per-campaign open and reply rates. Filter by campaign and by date. |
| **Settings** | Mailboxes (several sending identities, chosen per campaign), sender name, admin users, and which env vars are set. |

A cron (`/api/cron`) imports finished searches, checks IMAP for replies, drafts what is due and
sends what is approved — replies first, so a lead who answered never gets the next step. Every
step also has a manual button in the UI. See [Cron and your Vercel plan](#cron-and-your-vercel-plan).

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
| `CLAUDE_MODEL_QUALIFY` | Optional. Default `claude-sonnet-5` |
| `CLAUDE_MODEL_RESEARCH` | Optional. Default `claude-haiku-4-5` — research is the bulk of the bill |
| `CLAUDE_MODEL_DRAFT` | Optional. Default `claude-opus-5` — this output is the reply rate |
| `APIFY_TOKEN` | apify.com → Settings → API tokens |
| `SMTP_*`, `IMAP_*`, `FROM_EMAIL` | **Fallback only.** Mailboxes live in the database — add them under Settings. These are used only when no mailbox exists, so an existing install keeps sending. |
| `APP_URL` | Public URL, for the open-tracking pixel. Auto-detected on Vercel. |
| `AUTH_SECRET` | `openssl rand -base64 32`. Signs sessions **and** derives the key that encrypts mailbox passwords — changing it means re-entering every mailbox password. |
| `CRON_SECRET` | `openssl rand -base64 32` |

### 3. First run

```bash
npm run dev
```

Open `/login`. With no users in the database the form creates the admin account — the
first email and password you enter become the login. Add more people later under Settings.

Targeting lives on the campaign, not globally: create a campaign, tick the searches it should
pull from, write its ICP and set a score floor. Then press **Run now** — or leave it to the
cron. Nothing happens until the campaign has an ICP.

Company research is not a step you run. The first time an email is written to a company,
Claude web-searches it and stores the brief on the lead; every later email — in that campaign
or any other — reuses it. If the search fails, the email is still written, just from the
scraped data alone.

### 4. Deploy

```bash
vercel deploy --prod
```

### Cron and your Vercel plan

`vercel.json` declares **two daily crons** (07:00 and 13:00 UTC), both hitting `/api/cron`.
That is deliberate: the Hobby plan rejects any schedule more frequent than once per day
(an hourly `0 * * * *` fails the deploy), but allows two cron jobs — so two daily runs is the
most responsive configuration Hobby permits.

Sequence delays are measured in days, so a twice-daily tick is the right granularity for
sending. What it does affect is latency on importing finished Apify searches and on spotting
replies — worst case ~12 hours. Both have manual buttons in the UI ("Check for results" on
Searches, "Run pipeline now" on the dashboard) when you don't want to wait.

On Pro, replace both entries with a single hourly one:

```json
"crons": [{ "path": "/api/cron", "schedule": "0 * * * *" }]
```

Verify what actually registered after deploying:

```bash
vercel crons ls
vercel crons run /api/cron   # trigger it by hand
```

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
- Theme: light / dark / system, switched from the header and remembered per browser.
  The login screen has no switcher and follows the OS.
