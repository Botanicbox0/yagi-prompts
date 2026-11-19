-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0098 — who set a library picture's category
-- (docs/BRAND-STUDIO-V3.md §4.1).
--
--   brand_studio_assets (+)  role_source  text, null | 'auto' | 'user'
--
-- `role` (0076) steers Prompt Architect's reference directive. After an image upload the studio reads the
-- thumbnail once (lib/brand-studio/asset-role.ts) and saves a category only when it is sure:
--   'auto'  the upload check ran. With a role: recognised automatically. Without one: the picture was
--           doubtful and stays empty; it is never asked about again.
--   'user'  the customer set or cleared the category (on upload, in the edit dialog, or when saving a
--           result with a category). The check never writes over it.
--   null    nobody set it and no check finished yet (every row before this migration).
--
-- Safe on the live table: a nullable column with no default (no rewrite) and a check every existing row
-- satisfies. Apply before the code that reads it is deployed (the server selects and writes it).
--
-- Pairs with glue 0171 (re-asserts the table's posture from 0152; a new column needs no new grant).

alter table brand_studio_assets
  add column if not exists role_source text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_assets_role_source') then
    alter table brand_studio_assets add constraint brand_studio_assets_role_source
      check (role_source is null or role_source in ('auto', 'user'));
  end if;
end $$;
