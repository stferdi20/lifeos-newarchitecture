create table if not exists public.legacy_entity_records (
  entity_type text not null,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  record_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (entity_type, owner_user_id, record_id)
);

create index if not exists legacy_entity_records_owner_entity_idx
  on public.legacy_entity_records (owner_user_id, entity_type);

create index if not exists legacy_entity_records_data_gin_idx
  on public.legacy_entity_records
  using gin (data jsonb_path_ops);

alter table public.legacy_entity_records enable row level security;

drop policy if exists "legacy_entity_records_select_own" on public.legacy_entity_records;
create policy "legacy_entity_records_select_own"
  on public.legacy_entity_records
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "legacy_entity_records_insert_own" on public.legacy_entity_records;
create policy "legacy_entity_records_insert_own"
  on public.legacy_entity_records
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "legacy_entity_records_update_own" on public.legacy_entity_records;
create policy "legacy_entity_records_update_own"
  on public.legacy_entity_records
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "legacy_entity_records_delete_own" on public.legacy_entity_records;
create policy "legacy_entity_records_delete_own"
  on public.legacy_entity_records
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

grant select, insert, update, delete on public.legacy_entity_records to authenticated;
grant select, insert, update, delete on public.legacy_entity_records to service_role;
