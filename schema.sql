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
  search_id           int references searches(id) on delete set null,
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
  steps      jsonb not null default '[]'::jsonb, -- [{ "delay_days": 0, "goal": "..." }]
  status     text not null default 'active',     -- active | paused
  created_at timestamptz not null default now()
);

create table if not exists enrollments (
  id           serial primary key,
  campaign_id  int not null references campaigns(id) on delete cascade,
  lead_id      int not null references leads(id) on delete cascade,
  step         int not null default 0,
  status       text not null default 'active',  -- active | done | replied | stopped | bounced
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
create index if not exists idx_leads_search    on leads(search_id);
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
