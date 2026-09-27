-- Review and back up the live database before applying. This migration preserves all records.
begin;

create table if not exists public.app_user_roles (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  employee_id text not null unique references public.employees(id),
  active boolean not null default true,
  assigned_at timestamptz not null default now()
);
create table if not exists public.telegram_link_challenges (
  code_hash text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  employee_id text not null references public.employees(id),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.telegram_links add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
create unique index if not exists telegram_links_one_account on public.telegram_links(auth_user_id) where auth_user_id is not null;
alter table public.sales add column if not exists notification_chat_id bigint;
alter table public.expenses add column if not exists notification_chat_id bigint;
alter table public.sales add column if not exists is_practice boolean not null default false;
alter table public.expenses add column if not exists is_practice boolean not null default false;
alter table public.sales add column if not exists archived_at timestamptz;
alter table public.expenses add column if not exists archived_at timestamptz;
update public.sales set notification_chat_id=origin_chat_id where notification_chat_id is null and origin_chat_id is not null;
update public.expenses set notification_chat_id=origin_chat_id where notification_chat_id is null and origin_chat_id is not null;

-- Existing manual links remain as history but submissions are refused until
-- their owners connect them through the verified one-time flow.

create or replace function public.app_employee_id() returns text
language sql stable security definer set search_path=''
as $$select r.employee_id from public.app_user_roles r where r.auth_user_id=(select auth.uid()) and r.active=true limit 1$$;
revoke all on function public.app_employee_id() from public, anon;
grant execute on function public.app_employee_id() to authenticated;

create or replace function public.app_is_manager() returns boolean
language sql stable security definer set search_path=''
as $$select coalesce((select r.employee_id='svetlana' from public.app_user_roles r where r.auth_user_id=(select auth.uid()) and r.active=true),false)$$;
revoke all on function public.app_is_manager() from public, anon;
grant execute on function public.app_is_manager() to authenticated;

alter table public.app_user_roles enable row level security;
alter table public.telegram_link_challenges enable row level security;
create policy "read own role or manager" on public.app_user_roles for select to authenticated using (auth_user_id=(select auth.uid()) or (select public.app_is_manager()));
create policy "read own employee or manager" on public.employees for select to authenticated using (id=(select public.app_employee_id()) or (select public.app_is_manager()));
create policy "read own sales or manager" on public.sales for select to authenticated using (archived_at is null and (salesperson_id=(select public.app_employee_id()) or (select public.app_is_manager())));
create policy "read own expenses or manager" on public.expenses for select to authenticated using (archived_at is null and (reporter_id=(select public.app_employee_id()) or (select public.app_is_manager())));
create policy "read own events or manager" on public.delivery_events for select to authenticated using (
  (select public.app_is_manager()) or
  (transaction_type='sale' and exists (select 1 from public.sales s where s.reference=delivery_events.reference and s.salesperson_id=(select public.app_employee_id()) and s.archived_at is null)) or
  (transaction_type='expense' and exists (select 1 from public.expenses e where e.reference=delivery_events.reference and e.reporter_id=(select public.app_employee_id()) and e.archived_at is null))
);
create policy "read own link or manager" on public.telegram_links for select to authenticated using (auth_user_id=(select auth.uid()) or (select public.app_is_manager()));

revoke all on public.employees, public.sales, public.expenses, public.delivery_events, public.telegram_links, public.app_user_roles, public.telegram_link_challenges from anon, authenticated;
grant select on public.employees, public.sales, public.expenses, public.delivery_events, public.telegram_links, public.app_user_roles to authenticated;
grant select, insert, update on public.app_user_roles, public.telegram_link_challenges to service_role;
grant select, insert, update, delete on public.telegram_links to service_role;
grant select, insert, update on public.sales, public.expenses, public.delivery_events to service_role;

-- These functions are callable only by the server with its service key.
create or replace function public.assign_app_user(p_email text,p_employee_id text) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_user uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_employee_id not in ('richard','anastasia','jean-claude','kevin') then raise exception 'invalid staff role'; end if;
  select id into v_user from auth.users where lower(email)=lower(p_email) limit 1;
  if v_user is null then raise exception 'invite this email in Supabase Auth first'; end if;
  if exists(select 1 from public.app_user_roles where auth_user_id=v_user and employee_id<>p_employee_id) then raise exception 'account already assigned to a different role'; end if;
  insert into public.app_user_roles(auth_user_id,employee_id,active) values(v_user,p_employee_id,true)
  on conflict (employee_id) do update set auth_user_id=excluded.auth_user_id,active=true,assigned_at=now();
  return jsonb_build_object('employeeId',p_employee_id,'email',lower(p_email));
end$$;
revoke all on function public.assign_app_user(text,text) from public, anon, authenticated;
grant execute on function public.assign_app_user(text,text) to service_role;

create or replace function public.claim_telegram_link(p_code_hash text,p_telegram_user_id bigint,p_chat_id bigint) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_challenge public.telegram_link_challenges%rowtype; v_name text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if p_telegram_user_id<>p_chat_id then raise exception 'private chat and user must match'; end if;
  select * into v_challenge from public.telegram_link_challenges where code_hash=p_code_hash for update;
  if not found or v_challenge.used_at is not null or v_challenge.expires_at<=now() then raise exception 'link code expired or already used'; end if;
  if not exists(select 1 from public.app_user_roles where auth_user_id=v_challenge.auth_user_id and employee_id=v_challenge.employee_id and active=true) then raise exception 'account is inactive'; end if;
  delete from public.telegram_links where auth_user_id=v_challenge.auth_user_id;
  insert into public.telegram_links(telegram_user_id,chat_id,auth_user_id,employee_id,linked_at)
  values(p_telegram_user_id,p_chat_id,v_challenge.auth_user_id,v_challenge.employee_id,now())
  on conflict (telegram_user_id) do update set chat_id=excluded.chat_id,auth_user_id=excluded.auth_user_id,employee_id=excluded.employee_id,linked_at=now();
  update public.telegram_link_challenges set used_at=now() where code_hash=p_code_hash;
  select display_name into v_name from public.employees where id=v_challenge.employee_id;
  return jsonb_build_object('employee_name',v_name,'employee_id',v_challenge.employee_id);
end$$;
revoke all on function public.claim_telegram_link(text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.claim_telegram_link(text,bigint,bigint) to service_role;

create table if not exists public.practice_reset_backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  selected_refs text[] not null,
  sales jsonb not null,
  expenses jsonb not null,
  events jsonb not null,
  executed_at timestamptz,
  restored_at timestamptz
);
alter table public.practice_reset_backups enable row level security;
revoke all on public.practice_reset_backups from anon, authenticated;
grant select, insert, update on public.practice_reset_backups to service_role;

create or replace function public.prepare_practice_reset(p_refs text[]) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_refs text[]; v_sales jsonb; v_expenses jsonb; v_events jsonb; v_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select coalesce(array_agg(distinct x order by x),array[]::text[]) into v_refs from unnest(p_refs) x;
  if cardinality(v_refs)=0 or cardinality(v_refs)<>cardinality(p_refs) then raise exception 'select distinct practice records'; end if;
  if exists(select 1 from unnest(v_refs) x where not exists(select 1 from public.sales where reference=x and is_practice and archived_at is null) and not exists(select 1 from public.expenses where reference=x and is_practice and archived_at is null)) then raise exception 'selection includes an ineligible record'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by reference),'[]'::jsonb) into v_sales from public.sales s where reference=any(v_refs);
  select coalesce(jsonb_agg(to_jsonb(e) order by reference),'[]'::jsonb) into v_expenses from public.expenses e where reference=any(v_refs);
  select coalesce(jsonb_agg(to_jsonb(d) order by id),'[]'::jsonb) into v_events from public.delivery_events d where reference=any(v_refs);
  insert into public.practice_reset_backups(selected_refs,sales,expenses,events) values(v_refs,v_sales,v_expenses,v_events) returning id into v_id;
  return jsonb_build_object('backupId',v_id,'references',v_refs,'sales',v_sales,'expenses',v_expenses,'events',v_events);
end$$;
revoke all on function public.prepare_practice_reset(text[]) from public, anon, authenticated;
grant execute on function public.prepare_practice_reset(text[]) to service_role;

create or replace function public.execute_practice_reset(p_backup_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_backup public.practice_reset_backups%rowtype; v_sales jsonb; v_expenses jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select * into v_backup from public.practice_reset_backups where id=p_backup_id for update;
  if not found or v_backup.executed_at is not null then raise exception 'backup missing or already used'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by reference),'[]'::jsonb) into v_sales from public.sales s where reference=any(v_backup.selected_refs);
  select coalesce(jsonb_agg(to_jsonb(e) order by reference),'[]'::jsonb) into v_expenses from public.expenses e where reference=any(v_backup.selected_refs);
  if v_sales<>v_backup.sales or v_expenses<>v_backup.expenses then raise exception 'records changed after backup; create a fresh preview and backup'; end if;
  update public.sales set archived_at=now() where reference=any(v_backup.selected_refs) and is_practice and archived_at is null;
  update public.expenses set archived_at=now() where reference=any(v_backup.selected_refs) and is_practice and archived_at is null;
  update public.practice_reset_backups set executed_at=now() where id=p_backup_id;
  return jsonb_build_object('backupId',p_backup_id,'references',v_backup.selected_refs);
end$$;
revoke all on function public.execute_practice_reset(uuid) from public, anon, authenticated;
grant execute on function public.execute_practice_reset(uuid) to service_role;

create or replace function public.restore_practice_reset(p_backup_id uuid) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_backup public.practice_reset_backups%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select * into v_backup from public.practice_reset_backups where id=p_backup_id for update;
  if not found or v_backup.executed_at is null or v_backup.restored_at is not null then raise exception 'backup cannot be restored'; end if;
  update public.sales set archived_at=null where reference=any(v_backup.selected_refs) and is_practice;
  update public.expenses set archived_at=null where reference=any(v_backup.selected_refs) and is_practice;
  update public.practice_reset_backups set restored_at=now() where id=p_backup_id;
  return jsonb_build_object('backupId',p_backup_id,'references',v_backup.selected_refs);
end$$;
revoke all on function public.restore_practice_reset(uuid) from public, anon, authenticated;
grant execute on function public.restore_practice_reset(uuid) to service_role;

commit;

