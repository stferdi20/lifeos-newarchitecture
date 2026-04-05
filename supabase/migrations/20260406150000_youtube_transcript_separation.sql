create table if not exists public.youtube_transcript_settings (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_subtitle_languages text,
  prefer_manual_captions boolean not null default true,
  queue_missing_transcripts boolean not null default true,
  retry_failed_jobs boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.youtube_transcript_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  resource_id text not null,
  source_url text not null,
  status text not null default 'queued',
  retry_count integer not null default 0,
  last_error text,
  worker_id text,
  requested_at timestamptz not null default timezone('utc', now()),
  scheduled_for timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists youtube_transcript_jobs_owner_idx
  on public.youtube_transcript_jobs (owner_user_id, created_at desc);

create index if not exists youtube_transcript_jobs_status_idx
  on public.youtube_transcript_jobs (status, scheduled_for, created_at);

create table if not exists public.youtube_transcript_workers (
  worker_id text primary key,
  label text,
  status text not null default 'online',
  last_heartbeat_at timestamptz not null default timezone('utc', now()),
  current_job_id uuid references public.youtube_transcript_jobs(id) on delete set null,
  version text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.youtube_transcript_settings enable row level security;
alter table public.youtube_transcript_jobs enable row level security;

drop policy if exists "youtube_transcript_settings_select_own" on public.youtube_transcript_settings;
create policy "youtube_transcript_settings_select_own"
  on public.youtube_transcript_settings
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "youtube_transcript_settings_insert_own" on public.youtube_transcript_settings;
create policy "youtube_transcript_settings_insert_own"
  on public.youtube_transcript_settings
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "youtube_transcript_settings_update_own" on public.youtube_transcript_settings;
create policy "youtube_transcript_settings_update_own"
  on public.youtube_transcript_settings
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "youtube_transcript_jobs_select_own" on public.youtube_transcript_jobs;
create policy "youtube_transcript_jobs_select_own"
  on public.youtube_transcript_jobs
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "youtube_transcript_jobs_insert_own" on public.youtube_transcript_jobs;
create policy "youtube_transcript_jobs_insert_own"
  on public.youtube_transcript_jobs
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "youtube_transcript_jobs_update_own" on public.youtube_transcript_jobs;
create policy "youtube_transcript_jobs_update_own"
  on public.youtube_transcript_jobs
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

drop policy if exists "youtube_transcript_jobs_delete_own" on public.youtube_transcript_jobs;
create policy "youtube_transcript_jobs_delete_own"
  on public.youtube_transcript_jobs
  for delete
  to authenticated
  using (owner_user_id = auth.uid());

grant select, insert, update on public.youtube_transcript_settings to authenticated;
grant select, insert, update, delete on public.youtube_transcript_settings to service_role;
grant select, insert, update, delete on public.youtube_transcript_jobs to authenticated;
grant select, insert, update, delete on public.youtube_transcript_jobs to service_role;
grant select, insert, update, delete on public.youtube_transcript_workers to service_role;

drop trigger if exists youtube_transcript_settings_set_updated_at on public.youtube_transcript_settings;
create trigger youtube_transcript_settings_set_updated_at
before update on public.youtube_transcript_settings
for each row execute function public.set_updated_at();

drop trigger if exists youtube_transcript_jobs_set_updated_at on public.youtube_transcript_jobs;
create trigger youtube_transcript_jobs_set_updated_at
before update on public.youtube_transcript_jobs
for each row execute function public.set_updated_at();

drop trigger if exists youtube_transcript_workers_set_updated_at on public.youtube_transcript_workers;
create trigger youtube_transcript_workers_set_updated_at
before update on public.youtube_transcript_workers
for each row execute function public.set_updated_at();

insert into public.youtube_transcript_jobs (
  id,
  owner_user_id,
  resource_id,
  source_url,
  status,
  retry_count,
  last_error,
  worker_id,
  requested_at,
  scheduled_for,
  started_at,
  completed_at,
  payload,
  created_at,
  updated_at
)
select
  id,
  owner_user_id,
  resource_id,
  source_url,
  status,
  retry_count,
  last_error,
  worker_id,
  requested_at,
  scheduled_for,
  started_at,
  completed_at,
  payload,
  created_at,
  updated_at
from public.instagram_download_jobs
where payload->>'job_type' = 'youtube_transcript'
on conflict (id) do nothing;

delete from public.instagram_download_jobs
where payload->>'job_type' = 'youtube_transcript';
