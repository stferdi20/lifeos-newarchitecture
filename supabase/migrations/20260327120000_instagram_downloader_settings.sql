create table if not exists public.instagram_downloader_settings (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  download_base_dir text,
  worker_enabled boolean not null default true,
  auto_start_worker boolean not null default true,
  poll_interval_seconds integer not null default 10,
  preferred_drive_folder_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.instagram_downloader_settings enable row level security;

drop policy if exists "instagram_downloader_settings_select_own" on public.instagram_downloader_settings;
create policy "instagram_downloader_settings_select_own"
  on public.instagram_downloader_settings
  for select
  to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists "instagram_downloader_settings_insert_own" on public.instagram_downloader_settings;
create policy "instagram_downloader_settings_insert_own"
  on public.instagram_downloader_settings
  for insert
  to authenticated
  with check (owner_user_id = auth.uid());

drop policy if exists "instagram_downloader_settings_update_own" on public.instagram_downloader_settings;
create policy "instagram_downloader_settings_update_own"
  on public.instagram_downloader_settings
  for update
  to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

grant select, insert, update on public.instagram_downloader_settings to authenticated;
grant select, insert, update, delete on public.instagram_downloader_settings to service_role;

drop trigger if exists instagram_downloader_settings_set_updated_at on public.instagram_downloader_settings;
create trigger instagram_downloader_settings_set_updated_at
before update on public.instagram_downloader_settings
for each row execute function public.set_updated_at();
