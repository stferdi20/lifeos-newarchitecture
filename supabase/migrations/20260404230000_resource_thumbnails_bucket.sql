insert into storage.buckets (id, name, public)
values ('resource-thumbnails', 'resource-thumbnails', true)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public;
