-- 클라우드 적용 필요 — TWINGS · core migration 0208 — blog media 50MB & unlisted blog-make
--
-- 1. Widens `maker_works` per-file ceiling from 4 MB (Vercel body proxy era) to 50 MB (R2 direct
--    presigned upload + redirect streaming, matching SOTA creator blog 1080p/24fps web masters)
--    and per-creative gallery cap from 12 to 60 items.
-- 2. Adds `catalog_listed` (`boolean not null default true`) to `prompt_items` and
--    `platform_formats` so AI creatives and the studio can publish unlisted / blog-hosted runnable
--    formats (selfie generation + creator royalty settlement active inside blog posts and direct
--    links, omitted from official storefront listings and sitemaps).

do $$
declare
  cname text;
begin
  for cname in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.maker_works'::regclass
       and c.contype = 'c'
       and (
         pg_get_constraintdef(c.oid) like '%position%11%'
         or pg_get_constraintdef(c.oid) like '%bytes%4194304%'
       )
  loop
    execute format('alter table public.maker_works drop constraint %I', cname);
  end loop;
end $$;

alter table public.maker_works
  drop constraint if exists maker_works_position_range,
  drop constraint if exists maker_works_bytes_range;

alter table public.maker_works
  add constraint maker_works_position_range check (position between 0 and 59),
  add constraint maker_works_bytes_range check (bytes > 0 and bytes <= 52428800);

alter table public.prompt_items
  add column if not exists catalog_listed boolean not null default true;

alter table public.platform_formats
  add column if not exists catalog_listed boolean not null default true;

create index if not exists idx_prompt_items_catalog_listed
  on public.prompt_items (status, audience, catalog_listed)
  where status = 'published' and audience = 'public';
