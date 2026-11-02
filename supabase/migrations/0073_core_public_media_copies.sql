-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0073 — public files copied to R2 (docs/BRAND-MOAT-AND-STORAGE.md)
--
-- Apply this file (and 0149) before adding the R2_* variables to Vercel. Nothing reads or writes the
-- table until those variables exist, so deploying the code first changes nothing.
--
--   public_media_copies   one row per content-addressed `public-content` key the app has tried to
--                         copy. `verified_at` is set only after the public host returned the same
--                         bytes, and only those keys are served from the media host. Deleting a row
--                         sends that key back to Supabase; the Supabase original is never removed.
--
--   `next_attempt_at` is both the lease and the back-off: claiming a key moves it forward in one
--   statement, so two runs cannot read the same file from Supabase at once, and a file that keeps
--   failing is not read again on every run.

create table if not exists public_media_copies (
  key text primary key,
  mime text not null,
  size_bytes bigint not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_failure text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_media_copies_key check (key ~ '^[0-9a-f]{64}\.[a-z0-9]+$'),
  constraint public_media_copies_size check (size_bytes >= 0),
  constraint public_media_copies_attempts check (attempts >= 0)
);

-- The registry read: every verified key, on a table that stays small (one row per public file).
create index if not exists public_media_copies_verified_idx on public_media_copies (key) where verified_at is not null;
