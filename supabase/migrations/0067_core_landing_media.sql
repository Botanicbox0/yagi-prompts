-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0067 — landing media overrides (docs/CONTENT-SLOTS.md §0)
--
-- Apply this file (and 0147) before replacing a landing image from /admin/landing-media. Without it
-- the landings read "no overrides" and show their files from public/, exactly as before; only the
-- admin's replace button answers with an error.
--
--   landing_media   one row per replaced slot (lib/content/landing-media.ts names the slots). The
--                   image itself is a content-addressed object in the public bucket
--                   (`public-content/{sha256}.webp`); resetting a slot deletes its row, and the
--                   object stays (storage has no delete path by design, lib/storage/index.ts).

create table if not exists landing_media (
  slot text primary key,
  object_key text not null,
  mime text not null,
  width integer not null,
  height integer not null,
  size_bytes integer not null,
  original_name text,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint landing_media_slot check (slot ~ '^[a-z0-9-]+/[a-z0-9-]+$' and char_length(slot) <= 80),
  constraint landing_media_object_key check (object_key ~ '^[0-9a-f]{64}\.webp$'),
  constraint landing_media_mime check (mime = 'image/webp'),
  constraint landing_media_size check (width between 1 and 4096 and height between 1 and 4096 and size_bytes between 1 and 8388608),
  constraint landing_media_original_name check (original_name is null or char_length(original_name) between 1 and 200)
);
