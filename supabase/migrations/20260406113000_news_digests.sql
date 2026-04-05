create table if not exists public.news_digests (
  id uuid primary key default gen_random_uuid(),
  digest_date date not null,
  category text not null,
  headline_summary text not null,
  key_points jsonb not null default '[]'::jsonb,
  article_refs jsonb not null default '[]'::jsonb,
  source_count integer not null default 0,
  article_count integer not null default 0,
  generated_at timestamptz not null default timezone('utc', now()),
  partial boolean not null default false,
  degraded boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint news_digests_category_check check (category in ('all', 'ai', 'ai_research', 'tech', 'startups', 'crypto'))
);

create unique index if not exists news_digests_digest_date_category_idx
  on public.news_digests (digest_date, category);

alter table public.news_digests enable row level security;

drop policy if exists "authenticated read news digests" on public.news_digests;
create policy "authenticated read news digests" on public.news_digests
for select using (auth.role() = 'authenticated');

drop trigger if exists news_digests_set_updated_at on public.news_digests;
create trigger news_digests_set_updated_at
before update on public.news_digests
for each row execute function public.set_updated_at();
