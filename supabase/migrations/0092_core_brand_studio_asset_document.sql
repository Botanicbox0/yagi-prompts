-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0092 — documents as studio assets
-- (docs/BRAND-STUDIO-V6-PLAN.md §4.7; founder 2026-11-16 "ppt나 pdf도 ingest할 수 있게").
--
-- A brand studio asset may be a `document` (PDF or PPTX). Documents are material only: Gemini reads them
-- with a revision request; they are never sent to an image or video model. Their bytes live in the private
-- bucket (`orgs/{orgId}/studio/documents/{assetId}`), never on the public media domain.
--
-- `page_count` is the number of slides of a PPTX (read from the file). It stays null when the count is not
-- known for certain (every PDF): the screen shows a count only when it has one.
--
-- Safe to deploy the code first: the server checks for this column and for 'document' in the kind check
-- (`assetDocumentKindReady`) and keeps documents closed until both exist, whatever
-- `BRAND_STUDIO_DOCUMENTS` says.
--
-- No glue file: no RLS or grant changes. A new column is covered by the table's posture from 0152
-- (forced RLS, no browser policies, service_role only).

alter table brand_studio_assets
  add column if not exists page_count integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_assets_page_count') then
    alter table brand_studio_assets
      add constraint brand_studio_assets_page_count check (page_count is null or page_count between 1 and 10000);
  end if;
end $$;

-- Widening a check: drop and re-add with one more value. NOT VALID first so the add takes no long lock;
-- every existing row is 'image', 'video' or 'audio', so the validation cannot fail.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_studio_assets_kind' and pg_get_constraintdef(oid) like '%document%'
  ) then
    alter table brand_studio_assets drop constraint if exists brand_studio_assets_kind;
    alter table brand_studio_assets add constraint brand_studio_assets_kind check (kind in ('image','video','audio','document')) not valid;
    alter table brand_studio_assets validate constraint brand_studio_assets_kind;
  end if;
end $$;
