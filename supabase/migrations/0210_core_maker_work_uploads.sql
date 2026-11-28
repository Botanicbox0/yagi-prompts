-- 클라우드 적용 필요 — TWINGS · core migration 0210 — maker work presigned upload leases
--
-- Durable server-only ledger for presigned `maker_works` uploads (`upl_<32hex>`):
--   · minted inside `sql.transaction` under `profiles ... for update` so concurrent presigns
--     are counted atomically (`<= 30/hour`, `<= 10` active pending, and counted against
--     `BLOG_MAKER_WORKS_MAX` / `BLOG_MAKER_WORKS_MAX_BYTES`);
--   · `/api/makers/works/complete` consumes the matching active row (`completed_at is null` and
--     `expires_at > now()`) for `(upload_id, user_id, mime)` and verifies the uploaded byte size
--     matches `bytes`;
--   · `/api/renders/tick` sweeps expired `maker_work_uploads` rows and deletes their
--     `storage_key` from object storage independently of user activity.

create table if not exists public.maker_work_uploads (
  upload_id text primary key
    constraint maker_work_uploads_id_check check (upload_id ~ '^upl_[0-9a-f]{32}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  storage_key text not null unique,
  mime text not null
    constraint maker_work_uploads_mime_check check (
      mime in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')
    ),
  bytes integer not null
    constraint maker_work_uploads_bytes_check check (bytes > 0 and bytes <= 52428800),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  swept_at timestamptz
);

create index if not exists idx_maker_work_uploads_user_created
  on public.maker_work_uploads (user_id, created_at desc);

create index if not exists idx_maker_work_uploads_sweep
  on public.maker_work_uploads (expires_at asc)
  where swept_at is null;
