-- 클라우드 적용 필요. No glue migration: the three tables keep their existing RLS and grants
-- (0106/0107/0111 revoke table-wide from anon/authenticated; new columns inherit that).
--
-- Creator video resolution (docs/CREATOR-RESOLUTION.md). A creator film renders at 720p unless
-- the buyer explicitly picks 1080p and pays the template's own 1080p price.
--
--   prompt_items.price_1080_cents / price_1080_krw
--       The founder-set 1080p price, in the same two currencies as the base price. 0 = 1080p is
--       not offered for this template (the default for every existing row, so nothing changes
--       until a price is set in the admin editor).
--   billing_payments.resolution / render_jobs.resolution
--       What was bought and what the provider is asked for. NULL = a row written before this
--       migration (or an image, or a brand production render): it rendered, and still renders, at
--       720p. A paid row's resolution never changes; retries re-read the same job row.

alter table prompt_items
  add column if not exists price_1080_cents integer not null default 0 check (price_1080_cents >= 0),
  add column if not exists price_1080_krw integer not null default 0 check (price_1080_krw >= 0);

alter table billing_payments
  add column if not exists resolution text check (resolution is null or resolution in ('720p', '1080p'));

alter table render_jobs
  add column if not exists resolution text check (resolution is null or resolution in ('720p', '1080p'));
