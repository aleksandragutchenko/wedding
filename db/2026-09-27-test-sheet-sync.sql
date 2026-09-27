-- Give every fictional transaction a permanent row in the Test Ledger tab.
-- Existing Sales and Expenses tabs and their records are untouched.
begin;
create sequence if not exists test_transactions_sheet_row_seq start with 2;
alter table test_transactions
  add column if not exists sheet_row bigint,
  add column if not exists sheet_sync_status text not null default 'Queued',
  add column if not exists sheet_sync_error text,
  add column if not exists sheet_synced_at timestamptz;
alter table test_transactions alter column sheet_row set default nextval('test_transactions_sheet_row_seq');
update test_transactions set sheet_row=nextval('test_transactions_sheet_row_seq') where sheet_row is null;
select setval('test_transactions_sheet_row_seq',greatest(coalesce((select max(sheet_row) from test_transactions),1),1),true);
alter table test_transactions alter column sheet_row set not null;
create unique index if not exists test_transactions_sheet_row_idx on test_transactions(sheet_row);
alter sequence test_transactions_sheet_row_seq owned by test_transactions.sheet_row;
grant usage,select on sequence test_transactions_sheet_row_seq to service_role;
commit;
