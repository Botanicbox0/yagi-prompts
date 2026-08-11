-- PLAYBOOK · M0 · SUPABASE GLUE migration 0101  (NOT applied by the PGlite test harness)
-- Storage buckets, PLAN §6 asset lifecycle.
--
--   content              private   revision-scoped staging: content/rev/{revision_id}/{uuid}.{ext}
--   public-content       PUBLIC    heroes + `public` blocks of showcase revisions ({sha256}.{ext})
--   content-published    private   every other published block ({sha256}.{ext})
--   artifacts-published  private   workflow files ({sha256}.{ext})
--
-- Write-once posture: the copier writes with upsert:false, v1 ships no delete path for
-- published objects, and content-hash keys make overwrites structurally inert.
-- Disclosure doctrine: anything ever served from `public-content` is permanently disclosed.

insert into storage.buckets (id, name, public)
values
  ('content',             'content',             false),
  ('public-content',      'public-content',      true),
  ('content-published',   'content-published',   false),
  ('artifacts-published', 'artifacts-published', false)
on conflict (id) do update set public = excluded.public;

-- Storage RLS: Supabase enables RLS on storage.objects by default. We deliberately create
-- NO policies for anon/authenticated — deny-all, consistent with the table posture. All
-- reads go through /api/media/[blockId] (signed URLs, ≤60s) or the public bucket CDN.
-- Nothing to add here; this comment is the record that the omission is intentional.
