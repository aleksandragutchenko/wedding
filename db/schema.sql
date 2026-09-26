create table if not exists employees (
  id text primary key check (id in ('richard','anastasia','jean-claude','kevin','svetlana')),
  display_name text not null,
  role text not null check (role in ('salesperson','expense_reporter','manager'))
);
insert into employees (id,display_name,role) values
('richard','Richard Darling','salesperson'),
('anastasia','Anastasia Ferrari','salesperson'),
('jean-claude','Jean-Claude Bērziņš','salesperson'),
('kevin','Kevin von Whatever','expense_reporter'),
('svetlana','Svetlana de Monte Carlo','manager')
on conflict (id) do nothing;

create table if not exists telegram_links (
  telegram_user_id bigint primary key,
  employee_id text not null references employees(id),
  chat_id bigint not null,
  linked_at timestamptz not null default now()
);
create index if not exists telegram_links_employee_idx on telegram_links(employee_id);

create sequence if not exists sales_sheet_row_seq start 2;
create sequence if not exists expenses_sheet_row_seq start 2;

create table if not exists sales (
  reference text primary key check (reference ~ '^S[0-9A-Za-z_-]+$'),
  submitted_at timestamptz not null default now(),
  salesperson_id text not null references employees(id),
  customer text not null check (length(btrim(customer)) > 0),
  project text not null check (project in ('A','B')),
  description text not null check (length(btrim(description)) > 0),
  amount_cents bigint not null check (amount_cents > 0),
  proposed_r integer not null check (proposed_r between 0 and 100),
  proposed_a integer not null check (proposed_a between 0 and 100),
  proposed_j integer not null check (proposed_j between 0 and 100),
  final_r integer check (final_r between 0 and 100),
  final_a integer check (final_a between 0 and 100),
  final_j integer check (final_j between 0 and 100),
  status text not null default 'Pending approval' check (status in ('Pending approval','Approved')),
  decided_at timestamptz,
  source text not null check (source in ('web','telegram')),
  origin_chat_id bigint,
  sheet_row bigint not null unique default nextval('sales_sheet_row_seq'),
  sheet_sync_status text not null default 'Sync pending' check (sheet_sync_status in ('Synced','Sync pending','Sync failed')),
  sheet_sync_error text,
  constraint proposed_total check (proposed_r + proposed_a + proposed_j = 100),
  constraint final_consistent check ((status='Pending approval' and final_r is null and final_a is null and final_j is null and decided_at is null) or (status='Approved' and final_r is not null and final_a is not null and final_j is not null and final_r + final_a + final_j = 100 and decided_at is not null))
);

create table if not exists expenses (
  reference text primary key check (reference ~ '^E[0-9A-Za-z_-]+$'),
  submitted_at timestamptz not null default now(),
  reporter_id text not null references employees(id),
  description text not null check (length(btrim(description)) > 0),
  category text not null check (category in ('Materials','Travel','Other')),
  amount_cents bigint not null check (amount_cents > 0),
  proposed_allocation text not null check (proposed_allocation in ('A','B','Company overhead')),
  final_allocation text check (final_allocation in ('A','B','Company overhead')),
  status text not null check (status in ('Awaiting allocation','Allocated')),
  decided_at timestamptz,
  source text not null check (source in ('web','telegram')),
  origin_chat_id bigint,
  sheet_row bigint not null unique default nextval('expenses_sheet_row_seq'),
  sheet_sync_status text not null default 'Sync pending' check (sheet_sync_status in ('Synced','Sync pending','Sync failed')),
  sheet_sync_error text,
  constraint allocation_consistent check ((status='Awaiting allocation' and final_allocation is null and decided_at is null) or (status='Allocated' and final_allocation is not null))
);

create table if not exists delivery_events (
  id bigint generated always as identity primary key,
  transaction_type text not null check (transaction_type in ('sale','expense')),
  reference text not null,
  event_type text not null check (event_type in ('submission','decision')),
  chat_id bigint,
  message text not null,
  status text not null check (status in ('Delivery pending','Delivered','Delivery failed','No Telegram recipient linked')),
  error text,
  attempts integer not null default 0,
  updated_at timestamptz not null default now(),
  unique(transaction_type, reference, event_type)
);

-- Only server-side secret-key requests can access these tables through the Data API.
alter table employees enable row level security;
alter table telegram_links enable row level security;
alter table sales enable row level security;
alter table expenses enable row level security;
alter table delivery_events enable row level security;

grant select on employees to service_role;
grant select, insert, update on telegram_links, sales, expenses, delivery_events to service_role;
grant usage, select on sequence sales_sheet_row_seq, expenses_sheet_row_seq, delivery_events_id_seq to service_role;
