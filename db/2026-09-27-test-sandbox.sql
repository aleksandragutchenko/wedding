-- Run only after reviewing the unpublished implementation. These tables are
-- separate from the S01-S05 / E01-E07 homework ledger and Google Sheet.
begin;
create extension if not exists pgcrypto;

create table if not exists test_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create table if not exists test_link_challenges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references test_sessions(id) on delete cascade,
  chat_id bigint not null check (chat_id > 0),
  employee_id text not null check (employee_id in ('richard','anastasia','jean-claude','kevin')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists test_challenge_rate_idx on test_link_challenges(chat_id,created_at desc);

create table if not exists test_telegram_links (
  telegram_user_id bigint primary key check (telegram_user_id > 0),
  chat_id bigint not null unique check (chat_id > 0),
  session_id uuid not null references test_sessions(id) on delete cascade,
  employee_id text not null check (employee_id in ('richard','anastasia','jean-claude','kevin')),
  linked_at timestamptz not null default now(),
  constraint own_private_chat check (telegram_user_id = chat_id)
);
create index if not exists test_links_session_idx on test_telegram_links(session_id);

create table if not exists test_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references test_sessions(id) on delete cascade,
  reference text not null check (reference ~ '^[SE][0-9A-Z_-]+$'),
  type text not null check (type in ('sale','expense')),
  employee_id text not null check (employee_id in ('richard','anastasia','jean-claude','kevin')),
  source text not null check (source in ('web','telegram')),
  notification_chat_id bigint,
  submitted_at timestamptz not null default now(),
  customer text,
  project text check (project in ('A','B')),
  description text not null check (length(btrim(description)) > 0),
  category text check (category in ('Materials','Travel','Other')),
  amount_cents bigint not null check (amount_cents > 0),
  proposed_r integer check (proposed_r between 0 and 100),
  proposed_a integer check (proposed_a between 0 and 100),
  proposed_j integer check (proposed_j between 0 and 100),
  final_r integer check (final_r between 0 and 100),
  final_a integer check (final_a between 0 and 100),
  final_j integer check (final_j between 0 and 100),
  proposed_allocation text check (proposed_allocation in ('A','B','Company overhead')),
  final_allocation text check (final_allocation in ('A','B','Company overhead')),
  status text not null check (status in ('Pending approval','Approved','Awaiting allocation','Allocated')),
  decided_at timestamptz,
  reset_at timestamptz,
  constraint test_sale_shape check (
    (type='sale' and employee_id in ('richard','anastasia','jean-claude') and reference like 'S%' and customer is not null and project is not null and proposed_r+proposed_a+proposed_j=100 and category is null and proposed_allocation is null and status in ('Pending approval','Approved'))
    or (type='expense' and employee_id='kevin' and reference like 'E%' and category is not null and proposed_allocation is not null and customer is null and project is null and status in ('Awaiting allocation','Allocated'))
  ),
  constraint test_decision_shape check (
    (type='sale' and ((status='Pending approval' and final_r is null and final_a is null and final_j is null and decided_at is null) or (status='Approved' and final_r+final_a+final_j=100 and decided_at is not null)))
    or (type='expense' and ((status='Awaiting allocation' and final_allocation is null) or (status='Allocated' and final_allocation is not null)))
  )
);
create index if not exists test_transactions_session_idx on test_transactions(session_id,submitted_at);
create unique index if not exists test_active_reference_idx on test_transactions(session_id,reference) where reset_at is null;

create table if not exists test_delivery_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references test_sessions(id) on delete cascade,
  transaction_id uuid not null references test_transactions(id) on delete cascade,
  event_type text not null check (event_type in ('submission','decision')),
  chat_id bigint,
  message text not null,
  status text not null check (status in ('Delivery pending','Delivery sending','Delivered','Delivery failed','No Telegram recipient linked')),
  error text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(transaction_id,event_type)
);

-- Service role access only. Neither the public anon key nor a signed-in user
-- may query these tables directly through Supabase's Data API.
alter table test_sessions enable row level security;
alter table test_link_challenges enable row level security;
alter table test_telegram_links enable row level security;
alter table test_transactions enable row level security;
alter table test_delivery_events enable row level security;
revoke all on test_sessions,test_link_challenges,test_telegram_links,test_transactions,test_delivery_events from public,anon,authenticated;
grant select,insert,update,delete on test_sessions,test_link_challenges,test_telegram_links,test_transactions,test_delivery_events to service_role;
grant usage,select on sequence test_delivery_events_id_seq to service_role;

-- Only a Telegram callback from the private chat can claim a challenge.
-- The opaque challenge ID is sent in an inline button to that chat, never
-- accepted from the browser as proof of ownership.
create or replace function claim_test_link_button(p_challenge_id uuid,p_telegram_user_id bigint,p_chat_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c test_link_challenges%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'service role required' using errcode='P0001'; end if;
  select * into c from test_link_challenges
    where id=p_challenge_id for update;
  if not found or c.used_at is not null or c.expires_at<=now() then
    raise exception 'This test link request has expired. Request a new one on the website.' using errcode='P0001';
  end if;
  if p_telegram_user_id<>p_chat_id or c.chat_id<>p_chat_id then
    raise exception 'Confirm only from the private Telegram chat that received this button.' using errcode='P0001';
  end if;
  if not exists(select 1 from test_sessions where id=c.session_id and expires_at>now()) then
    raise exception 'The website test session has expired.' using errcode='P0001';
  end if;
  update test_link_challenges set used_at=now() where id=c.id;
  delete from test_telegram_links where chat_id=p_chat_id;
  insert into test_telegram_links(telegram_user_id,chat_id,session_id,employee_id)
    values(p_chat_id,p_chat_id,c.session_id,c.employee_id);
  return jsonb_build_object('employeeId',c.employee_id);
end $$;
revoke all on function claim_test_link_button(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function claim_test_link_button(uuid,bigint,bigint) to service_role;
commit;
