-- 클라우드 적용 필요 — TWINGS · core migration 0190 — template style preference, schema only (pairs with 0191)
--
-- docs/PERSONAL-STUDIO.md §3.4.10 (founder decision 2026-11-25): a buyer picks a template style once ("여성 스타일" /
-- "남성 스타일"), the choice is kept on the account and can be changed in settings, and the template lists then show
-- that style's templates plus the ones for anyone. Never inferred from a photo or anything else.
--
-- Nothing in the deployed code reads or writes these columns until `TWINGS_TEMPLATE_LOOK=on`. With the switch on and
-- this file missing, every reader goes through the row's JSON (`to_jsonb(...)->>'look'`) and sees "for anyone" /
-- "not chosen", and the one writer (POST /api/account/template-look) answers `unavailable` instead of failing.
-- Safe to apply twice. Existing rows are not rewritten (a constant default is metadata-only).
--
--   prompt_items.look (+)            who the template is written for: 'any' (default, every row today), 'female',
--                                    'male'. Set only by the admin template form (prompt.create / prompt.update).
--   profiles.template_look (+)       the account's own choice: NULL (not chosen), 'female', 'male'. Written only by
--                                    the server route; profiles is denied to every browser key (0100).
--   profiles.template_look_set_at (+) when the choice last changed (set or cleared). NULL = never chosen.
--
-- Account deletion removes both profile columns with the row (lib/account/deletion.ts deletes `profiles`).

set lock_timeout = '3s';

-- 1. prompt_items.look ------------------------------------------------------------------------------------------------

alter table prompt_items add column if not exists look text not null default 'any';

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'prompt_items_look_known'
       and conrelid = 'public.prompt_items'::regclass
  ) then
    alter table prompt_items
      add constraint prompt_items_look_known check (look in ('any', 'female', 'male')) not valid;
  end if;
end $$;

alter table prompt_items validate constraint prompt_items_look_known;

-- 2. profiles.template_look -----------------------------------------------------------------------------------------

alter table profiles
  add column if not exists template_look text,
  add column if not exists template_look_set_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'profiles_template_look_known'
       and conrelid = 'public.profiles'::regclass
  ) then
    alter table profiles
      add constraint profiles_template_look_known
      check (template_look is null or template_look in ('female', 'male')) not valid;
  end if;
end $$;

alter table profiles validate constraint profiles_template_look_known;
