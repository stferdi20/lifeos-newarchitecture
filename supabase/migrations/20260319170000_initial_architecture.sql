create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  position integer not null default 0,
  is_archived boolean not null default false,
  drive_folder_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists workspaces_owner_slug_idx on public.workspaces (owner_user_id, slug);

create table if not exists public.workspace_memberships (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default timezone('utc', now()),
  primary key (workspace_id, user_id)
);

create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  is_archived boolean not null default false,
  drive_folder_id text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  list_id uuid references public.lists(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo',
  priority text not null default 'medium',
  due_date date,
  due_time text,
  position double precision not null default 0,
  drive_folder_id text,
  checklist jsonb not null default '[]'::jsonb,
  attached_files jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  card_id uuid references public.cards(id) on delete set null,
  source_checklist_item_id text,
  task_kind text not null default 'standalone',
  title text not null,
  description text,
  status text not null default 'todo',
  priority text not null default 'medium',
  due_date date,
  due_time text,
  google_task_id text,
  google_task_list_id text,
  google_sync_status text,
  google_last_synced_at timestamptz,
  reminder_enabled boolean not null default false,
  reminder_source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists tasks_owner_idx on public.tasks (owner_user_id, created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  card_id uuid references public.cards(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  author_user_id uuid references auth.users(id) on delete set null,
  body text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  source_url text not null,
  title text,
  summary text,
  main_topic text,
  score integer,
  tags text[] not null default '{}',
  insights jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  title text not null,
  content text,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  card_id uuid references public.cards(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  storage_bucket text,
  storage_path text,
  external_url text,
  external_provider text,
  file_name text not null,
  mime_type text,
  file_size bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  status text not null default 'connected',
  scope text,
  last_connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, service)
);

create table if not exists public.google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_type text,
  scope text,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, service)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  job_type text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  scheduled_for timestamptz not null default timezone('utc', now()),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null,
  started_at timestamptz,
  completed_at timestamptz,
  output jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.llm_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  task_type text not null,
  provider text,
  model text,
  tier text,
  request_summary text,
  response_excerpt text,
  token_input integer,
  token_output integer,
  estimated_cost_usd numeric(10, 6),
  latency_ms integer,
  status text not null default 'success',
  error_message text,
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspaces w
    left join public.workspace_memberships wm
      on wm.workspace_id = w.id
      and wm.user_id = auth.uid()
    where w.id = target_workspace_id
      and (
        w.owner_user_id = auth.uid()
        or wm.user_id = auth.uid()
      )
  );
$$;

create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.workspaces w
    left join public.workspace_memberships wm
      on wm.workspace_id = w.id
      and wm.user_id = auth.uid()
    where w.id = target_workspace_id
      and (
        w.owner_user_id = auth.uid()
        or wm.role in ('owner', 'admin')
      )
  );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;
alter table public.lists enable row level security;
alter table public.cards enable row level security;
alter table public.tasks enable row level security;
alter table public.comments enable row level security;
alter table public.resources enable row level security;
alter table public.notes enable row level security;
alter table public.attachments enable row level security;
alter table public.google_connections enable row level security;
alter table public.google_tokens enable row level security;
alter table public.jobs enable row level security;
alter table public.job_runs enable row level security;
alter table public.llm_runs enable row level security;

drop policy if exists "profiles self access" on public.profiles;
create policy "profiles self access" on public.profiles
for all using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "workspace members can read workspaces" on public.workspaces;
create policy "workspace members can read workspaces" on public.workspaces
for select using (public.is_workspace_member(id));
drop policy if exists "owners manage workspaces" on public.workspaces;
create policy "owners manage workspaces" on public.workspaces
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists "members read memberships" on public.workspace_memberships;
create policy "members read memberships" on public.workspace_memberships
for select using (user_id = auth.uid() or public.is_workspace_member(workspace_id));
drop policy if exists "owners manage memberships" on public.workspace_memberships;
create policy "owners manage memberships" on public.workspace_memberships
for all using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));

drop policy if exists "workspace members read lists" on public.lists;
create policy "workspace members read lists" on public.lists
for select using (public.is_workspace_member(workspace_id));
drop policy if exists "workspace managers manage lists" on public.lists;
create policy "workspace managers manage lists" on public.lists
for all using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));

drop policy if exists "workspace members read cards" on public.cards;
create policy "workspace members read cards" on public.cards
for select using (public.is_workspace_member(workspace_id));
drop policy if exists "workspace managers manage cards" on public.cards;
create policy "workspace managers manage cards" on public.cards
for all using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));

drop policy if exists "owners read tasks" on public.tasks;
create policy "owners read tasks" on public.tasks
for select using (owner_user_id = auth.uid());
drop policy if exists "owners manage tasks" on public.tasks;
create policy "owners manage tasks" on public.tasks
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists "workspace members read comments" on public.comments;
create policy "workspace members read comments" on public.comments
for select using (
  (workspace_id is not null and public.is_workspace_member(workspace_id))
  or author_user_id = auth.uid()
);
drop policy if exists "comment authors manage comments" on public.comments;
create policy "comment authors manage comments" on public.comments
for all using (author_user_id = auth.uid()) with check (author_user_id = auth.uid());

drop policy if exists "owners manage resources" on public.resources;
create policy "owners manage resources" on public.resources
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "owners manage notes" on public.notes;
create policy "owners manage notes" on public.notes
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "owners manage attachments" on public.attachments;
create policy "owners manage attachments" on public.attachments
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "owners manage google connections" on public.google_connections;
create policy "owners manage google connections" on public.google_connections
for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owners manage google tokens" on public.google_tokens;
create policy "owners manage google tokens" on public.google_tokens
for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "owners manage jobs" on public.jobs;
create policy "owners manage jobs" on public.jobs
for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "owners read job runs" on public.job_runs;
create policy "owners read job runs" on public.job_runs
for select using (
  exists (
    select 1 from public.jobs
    where jobs.id = job_runs.job_id
      and jobs.owner_user_id = auth.uid()
  )
);
drop policy if exists "owners read llm runs" on public.llm_runs;
create policy "owners read llm runs" on public.llm_runs
for select using (user_id = auth.uid());

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists lists_set_updated_at on public.lists;
create trigger lists_set_updated_at before update on public.lists for each row execute function public.set_updated_at();
drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at before update on public.cards for each row execute function public.set_updated_at();
drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at before update on public.comments for each row execute function public.set_updated_at();
drop trigger if exists resources_set_updated_at on public.resources;
create trigger resources_set_updated_at before update on public.resources for each row execute function public.set_updated_at();
drop trigger if exists notes_set_updated_at on public.notes;
create trigger notes_set_updated_at before update on public.notes for each row execute function public.set_updated_at();
drop trigger if exists attachments_set_updated_at on public.attachments;
create trigger attachments_set_updated_at before update on public.attachments for each row execute function public.set_updated_at();
drop trigger if exists google_connections_set_updated_at on public.google_connections;
create trigger google_connections_set_updated_at before update on public.google_connections for each row execute function public.set_updated_at();
drop trigger if exists google_tokens_set_updated_at on public.google_tokens;
create trigger google_tokens_set_updated_at before update on public.google_tokens for each row execute function public.set_updated_at();
drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at before update on public.jobs for each row execute function public.set_updated_at();

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;
