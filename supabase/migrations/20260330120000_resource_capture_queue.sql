create table if not exists public.resource_capture_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  resource_id text not null,
  source_url text not null,
  normalized_url text not null,
  status text not null default 'queued',
  retry_count integer not null default 0,
  last_error text,
  project_id text,
  capture_source text,
  worker_id text,
  requested_at timestamptz not null default timezone('utc', now()),
  scheduled_for timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists resource_capture_jobs_owner_idx
  on public.resource_capture_jobs (owner_user_id, created_at desc);

create index if not exists resource_capture_jobs_status_idx
  on public.resource_capture_jobs (status, scheduled_for, created_at);

create index if not exists resource_capture_jobs_owner_url_idx
  on public.resource_capture_jobs (owner_user_id, normalized_url, created_at desc);

alter table public.resource_capture_jobs enable row level security;

drop policy if exists "resource_capture_jobs_select_own" on public.resource_capture_jobs;
create policy "resource_capture_jobs_select_own"
  on public.resource_capture_jobs
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "resource_capture_jobs_insert_own" on public.resource_capture_jobs;
create policy "resource_capture_jobs_insert_own"
  on public.resource_capture_jobs
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "resource_capture_jobs_update_own" on public.resource_capture_jobs;
create policy "resource_capture_jobs_update_own"
  on public.resource_capture_jobs
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "resource_capture_jobs_delete_own" on public.resource_capture_jobs;
create policy "resource_capture_jobs_delete_own"
  on public.resource_capture_jobs
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

grant select, insert, update, delete on public.resource_capture_jobs to authenticated;
grant select, insert, update, delete on public.resource_capture_jobs to service_role;

drop trigger if exists resource_capture_jobs_set_updated_at on public.resource_capture_jobs;
create trigger resource_capture_jobs_set_updated_at
before update on public.resource_capture_jobs
for each row execute function public.set_updated_at();
