-- Opportunity Agent schema. Accessed only with the service-role key from server jobs;
-- RLS is enabled with no policies, so the public anon key can read nothing.

create table if not exists opportunities (
  key            text primary key,
  type           text not null,
  title          text not null,
  provider       text,
  official_url   text not null,
  source_ids     text[] not null default '{}',
  deadline       date,
  deadline_quote text,
  funding        text,
  score          int not null default 0,
  score_reason   text,
  verdict        text not null,                -- eligible | check | ineligible
  flagged        boolean not null default false,
  extracted      jsonb not null,               -- every fact + the exact source quote
  eligibility    jsonb not null,
  scam           jsonb not null,
  payout         jsonb,
  status         text not null default 'found', -- found|saved|preparing|waiting_on_me|submitted|interview|result|skipped|not_interested
  blocking       text,
  documents      text[] not null default '{}',
  notes          text,
  first_seen     timestamptz not null default now(),
  last_checked   timestamptz not null default now(),
  digested_at    timestamptz,
  alerted_at     timestamptz
);
create index if not exists opportunities_status_idx on opportunities(status);
create index if not exists opportunities_deadline_idx on opportunities(deadline);

-- Every lead URL already processed, so we never pay to re-extract the same page.
create table if not exists seen_urls (
  url_hash   text primary key,
  url        text not null,
  outcome    text not null,       -- stored | prefiltered | not_opportunity | ineligible | rejected | error
  opp_key    text,
  first_seen timestamptz not null default now()
);

create table if not exists feedback (
  id         bigserial primary key,
  opp_key    text not null references opportunities(key) on delete cascade,
  action     text not null,       -- apply | save | skip | not_interested | up | down | applied
  created_at timestamptz not null default now()
);
create index if not exists feedback_opp_key_idx on feedback(opp_key);

create table if not exists weights (
  key   text primary key,         -- type:x | provider:x | kw:x
  value real not null default 0
);

create table if not exists source_health (
  source_id text not null,
  run_date  date not null,
  ok        boolean not null,
  count     int not null,
  error     text,
  primary key (source_id, run_date)
);

create table if not exists ai_costs (
  id     bigserial primary key,
  run_at timestamptz not null default now(),
  job    text not null,
  usd    numeric(10,5) not null
);

create table if not exists reminders_sent (
  opp_key text not null references opportunities(key) on delete cascade,
  days    int not null,
  sent_at timestamptz not null default now(),
  primary key (opp_key, days)
);

-- Key/value settings: kill switch ("paused"), last weekly summary, etc.
create table if not exists agent_settings (
  key   text primary key,
  value jsonb not null
);
insert into agent_settings(key, value) values ('paused', 'false') on conflict do nothing;

alter table opportunities  enable row level security;
alter table seen_urls      enable row level security;
alter table feedback       enable row level security;
alter table weights        enable row level security;
alter table source_health  enable row level security;
alter table ai_costs       enable row level security;
alter table reminders_sent enable row level security;
alter table agent_settings enable row level security;
