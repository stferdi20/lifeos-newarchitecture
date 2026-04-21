alter table public.google_connections
add column if not exists reconnect_reason text;
