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
  score               int,
  verdict             text,                     -- strong | medium | weak
  reasons             text,
  angle               text,
  research            text,
  status              text not null default 'new', -- new | qualified | rejected | contacted | replied | won | lost
  created_at          timestamptz not null default now()
);

create table if not exists campaigns (
  id         serial primary key,
  name       text not null,
  offer      text not null default '',
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
