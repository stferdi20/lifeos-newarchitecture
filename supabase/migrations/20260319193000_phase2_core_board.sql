alter table public.cards
  add column if not exists start_date date,
  add column if not exists estimate text,
  add column if not exists labels jsonb not null default '[]'::jsonb,
  add column if not exists cover jsonb,
  add column if not exists dependencies jsonb not null default '[]'::jsonb,
  add column if not exists is_archived boolean not null default false;

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists activity_events_card_idx on public.activity_events (card_id, created_at desc);

alter table public.activity_events enable row level security;

drop policy if exists "workspace members read activity events" on public.activity_events;
create policy "workspace members read activity events" on public.activity_events
for select using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace managers manage activity events" on public.activity_events;
create policy "workspace managers manage activity events" on public.activity_events
for all using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));
