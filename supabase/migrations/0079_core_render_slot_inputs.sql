-- 클라우드 적용 필요 (pairs with 0153_glue_render_slot_inputs).
--
-- docs/CAST-CATEGORIES.md §3 — the buyer's OTHER photos: a pet, or (couples, behind
-- TWINGS_COUPLE_TEMPLATES) the partner. Never the buyer's own face: that stays in identity_selfies and
-- render_jobs.input_key under the existing rules.
--
--   render_id   the render job's id. A paid order binds its photos to billing_payments.render_ref
--               BEFORE the job exists (the job is created with that id when the payment confirms), so
--               there is deliberately no foreign key to render_jobs.
--   slot        'pet' | 'partner' — the recipe slot it fills (lib/recipes/schema.ts PET_SLOT/PARTNER_SLOT).
--   storage_key the private `renders` bucket object, `{render_id}/slot-{slot}.jpg` — or, for a pet-only
--               template, the job's own input photo (the pet is that template's one photo).
--   partner_consent_at
--               when the uploader confirmed the partner agreed. Required for a partner row.
--   expires_at  the hard cap. Files go as soon as the render is finished (succeeded or failed); this
--               catches a job that never finishes and an order that was never paid.
--   deleted_at  when the file was removed; the row stays as the record that it existed and was removed.
--   template_id which template it was for. Deliberately NO foreign key: a cascade would delete the row
--               the deletion sweep reads before the file goes, leaving the file orphaned in the bucket.
--
-- Not an identity table: nothing here is registered with a provider's face library, and a pet photo
-- is never face-checked. Provider moderation still applies to every image an engine receives.

create table if not exists render_slot_inputs (
  render_id uuid not null,
  slot text not null constraint render_slot_inputs_slot_known check (slot in ('pet', 'partner')),
  user_id uuid not null references auth.users (id) on delete cascade,
  template_id uuid not null,
  storage_key text not null,
  mime text not null constraint render_slot_inputs_mime_known check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  partner_consent_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  deleted_at timestamptz,
  primary key (render_id, slot),
  constraint render_slot_inputs_partner_consent check (slot <> 'partner' or partner_consent_at is not null)
);

-- The deletion sweep reads only live rows.
create index if not exists render_slot_inputs_live_idx on render_slot_inputs (expires_at) where deleted_at is null;
create index if not exists render_slot_inputs_user_idx on render_slot_inputs (user_id);
