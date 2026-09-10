-- Norrkusten Outreach — full schema. Idempotent; run with `npm run db:push`.

create table if not exists users (
  id            serial primary key,
  email         text unique not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create table if not exists settings (
  key   text primary key,
  value text not null
);

create table if not exists searches (
  id         serial primary key,
  label      text not null,
  input      jsonb not null,
  run_id     text,
  dataset_id text,
  status     text not null default 'running',   -- running | ready | failed
  imported   int  not null default 0,
  error      text,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id                  serial primary key,
  email               text unique not null,
  first_name          text,
  last_name           text,
  full_name           text,
  job_title           text,
  seniority           text,
  linkedin            text,
  phone               text,
  city                text,
  country             text,
  company_name        text,
  company_domain      text,
  company_website     text,
  company_linkedin    text,
  company_size        text,
  industry            text,
  company_description text,
  raw                 jsonb not null default '{}'::jsonb,
  research            text,                     -- company brief; campaign-independent, so it lives here
  status              text not null default 'new', -- new | contacted | replied | won | lost | rejected
  created_at          timestamptz not null default now()
);

create table if not exists campaigns (
  id         serial primary key,
  name       text not null,
  icp        text not null default '',          -- who this campaign targets; drives scoring
  offer      text not null default '',
  source_search_ids int[] not null default '{}',-- searches this campaign pulls leads from
  min_score  int not null default 50,           -- below this, never drafted or sent
  guidelines text not null default '',          -- how this campaign's emails should read
  links      text[] not null default '{}',      -- pages the emails should point at
  language   text not null default 'sv',
  from_name  text,
  auto_send  boolean not null default false,
  writing_mode text not null default 'ai',    -- ai | fixed (the same email for everyone)
  steps      jsonb not null default '[]'::jsonb, -- ai:    [{ "delay_days": 0, "goal": "..." }]
                                                 -- fixed: [{ "delay_days": 0, "subject": "...",
                                                 --           "body": "..." }]
  status     text not null default 'active',     -- active | paused
  created_at timestamptz not null default now()
);

create table if not exists enrollments (
  id           serial primary key,
  campaign_id  int not null references campaigns(id) on delete cascade,
  lead_id      int not null references leads(id) on delete cascade,
  step         int not null default 0,
  status       text not null default 'active',  -- active | done | replied | stopped | bounced | removed
                                                -- 'removed' is kept, not deleted: the row is what
                                                -- stops the next pass re-enrolling them from the search
  score        int,                             -- scored against THIS campaign's ICP
  verdict      text,                            -- strong | medium | weak
  reasons      text,
  angle        text,
  next_send_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (campaign_id, lead_id)
);

create table if not exists messages (
  id            serial primary key,
  enrollment_id int not null references enrollments(id) on delete cascade,
  lead_id       int not null references leads(id) on delete cascade,
  step          int not null,
  subject       text not null,
  body          text not null,
  status        text not null default 'draft',  -- draft | approved | sent | failed | skipped
  provider_id   text,
  error         text,
  sent_at       timestamptz,
  opened_at     timestamptz,
  click_count   int not null default 0,
  clicked_at    timestamptz,
  replied_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (enrollment_id, step)
);

create index if not exists idx_leads_status   on leads(status);
-- The sibling-research lookup in engine.ts runs once per lead about to be researched.
-- Partial: the only rows it ever wants are the ones that already have a brief.
create index if not exists idx_leads_research_domain on leads(company_domain)
  where research is not null;
create index if not exists idx_enroll_due      on enrollments(status, next_send_at);
create index if not exists idx_msg_status      on messages(status);
create index if not exists idx_msg_provider    on messages(provider_id);

-- analytics
alter table messages add column if not exists open_count int not null default 0;
create index if not exists idx_enroll_lead on enrollments(lead_id);

-- Scoring moved from leads to enrollments: a lead can be a strong fit for one
-- campaign and a poor fit for another, so the score belongs to the pairing.
alter table campaigns   add column if not exists icp     text not null default '';
alter table enrollments add column if not exists score   int;
alter table enrollments add column if not exists verdict text;
alter table enrollments add column if not exists reasons text;
alter table enrollments add column if not exists angle   text;
alter table leads drop column if exists score;
alter table leads drop column if exists verdict;
alter table leads drop column if exists reasons;
alter table leads drop column if exists angle;
create index if not exists idx_enroll_score on enrollments(campaign_id, score desc nulls last);

-- One row per round, so a bad afternoon can be looked at afterwards. Rounds happen
-- twenty times a day on a schedule nobody is watching, and until this the only record was
-- a single settings row holding the most recent one.
create table if not exists runs (
  id          serial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  result      jsonb,      -- what the round did: sent, drafted, bounced, throttled...
  error       text        -- set instead when it threw
);
create index if not exists idx_runs_started on runs(started_at desc);

-- What the reply actually said, so a reply can be triaged without leaving the app, and
-- so an explicit "take me off your list" can be acted on rather than waiting to be read.
alter table messages add column if not exists reply_text    text;
alter table messages add column if not exists reply_intent  text;  -- see classifyReply
alter table messages add column if not exists reply_summary text;

-- Not every campaign wants a written-per-lead email. A fixed campaign sends the same
-- subject and body to everyone, with only the placeholders filled in per lead.
alter table campaigns add column if not exists writing_mode text not null default 'ai';

-- A campaign pulls its own leads from named searches and gates on a score floor,
-- so enrolling, scoring and researching stop being manual steps.
alter table campaigns add column if not exists source_search_ids int[] not null default '{}';
alter table campaigns add column if not exists min_score int not null default 50;

-- Per-campaign control over how the email is written, and what it links to.
alter table campaigns add column if not exists guidelines text not null default '';
alter table campaigns add column if not exists links      text[] not null default '{}';
alter table campaigns drop column if exists link_url;
alter table messages  add column if not exists click_count int not null default 0;
alter table messages  add column if not exists clicked_at  timestamptz;

-- Sending identities. Several mailboxes, chosen per campaign, so outreach can come
-- from the person who owns the relationship rather than one shared address.
create table if not exists mailboxes (
  id          serial primary key,
  name        text not null,
  from_email  text not null,
  reply_to    text,
  smtp_host   text not null,
  smtp_port   int  not null default 465,
  smtp_user   text not null,
  smtp_pass   text not null,
  signature   text not null default '',
  imap_host   text,
  imap_port   int  not null default 993,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table campaigns add column if not exists mailbox_id int references mailboxes(id) on delete set null;
alter table mailboxes add column if not exists signature text not null default '';

-- Suppression list. Survives lead deletion on purpose: a person who asked to be left
-- alone must stay left alone even if a later search re-imports their address.
-- An entry starting with '@' suppresses the whole domain.
create table if not exists suppressions (
  email      text primary key,
  reason     text not null default '',
  source     text not null default 'manual',  -- manual | unsubscribe | bounce
  created_at timestamptz not null default now()
);

-- Which mailbox actually sent a message. The campaign's mailbox_id can change later,
-- so the send-rate ledger has to read what was used at the time, not what is set now.
alter table messages add column if not exists mailbox_id int references mailboxes(id) on delete set null;
create index if not exists idx_msg_sent_at on messages(mailbox_id, sent_at);

-- What the model calls actually cost, as reported by the API rather than estimated.
-- costs.ts quotes a run before you press the button from hand-counted tokens; this is
-- the ground truth to correct those numbers against. Written fire-and-forget, so a
-- failure here never costs a draft.
create table if not exists ai_usage (
  id                bigserial primary key,
  op                text not null,   -- qualify | research | draft | campaign | search | reply
  model             text not null,
  input_tokens      int  not null,
  cache_read_tokens int  not null default 0,
  output_tokens     int  not null,
  thinking_tokens   int  not null default 0,
  web_searches      int  not null default 0,
  web_fetches       int  not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_ai_usage_op on ai_usage(op, id desc);

-- Which searches found a lead — many to many, because one address turns up in several.
--
-- This used to be a single `leads.search_id`. The insert is `on conflict (email) do
-- nothing`, so the second search to find someone imported nothing and, as far as the app
-- was concerned, had not found them: delete a search, run the same one again, and only
-- the handful of genuinely new addresses came back. The rest were still there, orphaned
-- and invisible, because the column could only ever remember the first search.
create table if not exists lead_searches (
  search_id  int not null references searches(id) on delete cascade,
  lead_id    int not null references leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (search_id, lead_id)
);
-- "which searches is this lead in", the direction the primary key does not serve.
create index if not exists idx_lead_searches_lead on lead_searches(lead_id);

-- Guarded so the file stays idempotent: on a database that already migrated, and on a
-- fresh one, there is no column to read and this is a no-op.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'leads' and column_name = 'search_id') then
    insert into lead_searches (search_id, lead_id)
      select search_id, id from leads where search_id is not null
      on conflict do nothing;
    alter table leads drop column search_id;
  end if;
end
$$;
drop index if exists idx_leads_search;

-- `searches.imported` used to be tallied inside the import loop, so whichever of the
-- cron, the Searches page and its poller got there second inserted nothing, counted 0,
-- and overwrote the real figure. lead_searches is the ground truth now; this puts the
-- displayed number back in step with it, and stays correct however often it runs.
update searches s
   set imported = (select count(*) from lead_searches ls where ls.search_id = s.id)
 where imported <> (select count(*) from lead_searches ls where ls.search_id = s.id);
-- Purchases mirrored from the LMS, so a sale can be tied back to the outreach that caused
-- it. A local copy rather than a live call per page: attribution is a join against leads
-- and messages, which has to happen in SQL, and the whole history is small enough to
-- mirror. `id` is the LMS's own id, so a re-sync updates rather than duplicates.
create table if not exists purchases (
  id             text primary key,
  purchased_at   timestamptz not null,
  org_name       text,
  org_number     text,
  course_code    text,
  course_title   text,
  -- Every address on the purchase — buyer, org contact, billing, participants — lowercased.
  -- The buyer is usually not the person we mailed, so matching on participants alone would
  -- miss most company purchases.
  emails         text[] not null default '{}',
  -- Derived from `emails` on the way in rather than asked of the API, since this is the
  -- column the domain match actually reads.
  domains        text[] not null default '{}',
  quantity       int not null default 1,
  total_excl_vat numeric(12,2),
  currency       text not null default 'SEK',
  payment_method text,
  source         text,
  raw            jsonb not null default '{}'::jsonb,
  synced_at      timestamptz not null default now()
);
create index if not exists idx_purchases_at      on purchases(purchased_at desc);
create index if not exists idx_purchases_emails  on purchases using gin (emails);
create index if not exists idx_purchases_domains on purchases using gin (domains);

-- Attribution. One row per purchase that can be credited to a lead we emailed, so every
-- count downstream is a plain count and revenue cannot be double-counted: a purchase at a
-- company where two people were mailed still resolves to a single row.
--
-- Dropped and recreated rather than `create or replace`, which refuses a changed column
-- list and would break `npm run db:push` on the next edit here.
drop view if exists conversions;
create view conversions as
with win as (
  select coalesce((select nullif(value, '')::int from settings
                    where key = 'attribution_window_days'), 90) as days
),
touched as (
  -- Every lead actually emailed. The window opens at the first send; the credit goes to
  -- whichever campaign spoke to them most recently, which is the one that closed it.
  select m.lead_id,
         min(m.sent_at) as first_sent_at,
         (array_agg(e.campaign_id order by m.sent_at desc))[1] as campaign_id
    from messages m join enrollments e on e.id = m.enrollment_id
   where m.sent_at is not null
   group by m.lead_id
),
lead_keys as (
  -- The lead's company reduced to something comparable. Legal forms go first, so
  -- "St1 Sverige AB" and "St1 Sverige" agree, then everything that is not a letter or
  -- digit, so punctuation and spacing stop mattering.
  select l.id, l.email, l.company_name,
         lower(regexp_replace(
           coalesce(nullif(l.company_domain, ''), split_part(l.email, '@', 2)),
           '^www\.', '')) as domain,
         regexp_replace(regexp_replace(lower(coalesce(l.company_name, '')),
           '\m(ab|aktiebolag|publ|hb|kb|oy|as)\M', '', 'g'),
           '[^a-z0-9]', '', 'g') as company
    from leads l
),
purchase_keys as (
  select p.*, regexp_replace(regexp_replace(lower(coalesce(p.org_name, '')),
           '\m(ab|aktiebolag|publ|hb|kb|oy|as)\M', '', 'g'),
           '[^a-z0-9]', '', 'g') as company
    from purchases p
)
select distinct on (p.id)
       p.id as purchase_id,
       t.lead_id,
       t.campaign_id,
       t.first_sent_at,
       p.purchased_at,
       p.course_code,
       p.course_title,
       p.org_name,
       p.quantity,
       p.total_excl_vat,
       p.currency,
       case when k.email = any(p.emails)                          then 'email'
            when k.domain <> '' and k.domain = any(p.domains)      then 'domain'
            else 'company' end as matched_on
  from purchase_keys p
  join touched t on true
  join lead_keys k on k.id = t.lead_id
 cross join win w
 where p.purchased_at >= t.first_sent_at
   and p.purchased_at < t.first_sent_at + (w.days || ' days')::interval
   and (
        k.email = any(p.emails)
     or (k.domain <> '' and k.domain = any(p.domains))
        -- Name matching is the fallback for a buyer whose address is on another domain
        -- than the one we mailed (@st1.se paying for a lead at @st1.com). Four characters
        -- minimum: shorter keys are initials and match half the register.
     or (length(k.company) >= 4 and k.company = p.company)
   )
 -- Strongest evidence first, then the earliest lead reached, so the credited lead is
 -- stable between runs instead of flipping between two colleagues at one company.
 order by p.id,
          case when k.email = any(p.emails) then 0
               when k.domain <> '' and k.domain = any(p.domains) then 1
               else 2 end,
          t.first_sent_at;
