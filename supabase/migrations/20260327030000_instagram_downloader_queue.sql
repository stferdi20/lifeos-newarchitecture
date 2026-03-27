create table if not exists public.instagram_download_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  resource_id text not null,
  source_url text not null,
  status text not null default 'queued',
  retry_count integer not null default 0,
  last_error text,
  drive_target text not null default 'global_instagram_folder',
  drive_folder_id text,
  project_id text,
  include_analysis boolean not null default true,
  worker_id text,
  requested_at timestamptz not null default timezone('utc', now()),
  scheduled_for timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists instagram_download_jobs_owner_idx
  on public.instagram_download_jobs (owner_user_id, created_at desc);

create index if not exists instagram_download_jobs_status_idx
  on public.instagram_download_jobs (status, scheduled_for, created_at);

create table if not exists public.instagram_downloader_workers (
  worker_id text primary key,
  label text,
  status text not null default 'online',
  last_heartbeat_at timestamptz not null default timezone('utc', now()),
  current_job_id uuid references public.instagram_download_jobs(id) on delete set null,
  version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.instagram_download_jobs enable row level security;

drop policy if exists "instagram_download_jobs_select_own" on public.instagram_download_jobs;
create policy "instagram_download_jobs_select_own"
  on public.instagram_download_jobs
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "instagram_download_jobs_insert_own" on public.instagram_download_jobs;
create policy "instagram_download_jobs_insert_own"
  on public.instagram_download_jobs
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "instagram_download_jobs_update_own" on public.instagram_download_jobs;
create policy "instagram_download_jobs_update_own"
  on public.instagram_download_jobs
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "instagram_download_jobs_delete_own" on public.instagram_download_jobs;
create policy "instagram_download_jobs_delete_own"
  on public.instagram_download_jobs
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

grant select, insert, update, delete on public.instagram_download_jobs to authenticated;
grant select, insert, update, delete on public.instagram_download_jobs to service_role;
grant select, insert, update, delete on public.instagram_downloader_workers to service_role;

drop trigger if exists instagram_download_jobs_set_updated_at on public.instagram_download_jobs;
create trigger instagram_download_jobs_set_updated_at
before update on public.instagram_download_jobs
for each row execute function public.set_updated_at();

drop trigger if exists instagram_downloader_workers_set_updated_at on public.instagram_downloader_workers;
create trigger instagram_downloader_workers_set_updated_at
before update on public.instagram_downloader_workers
for each row execute function public.set_updated_at();
