-- 클라우드 적용 필요. No glue migration: prompt_items keeps 0102's posture (the whole table is denied
-- to every browser role; reads go through the server), and a new column inherits it.
--
-- docs/CAST-CATEGORIES.md — who is in a template, a third axis beside `medium` (what it produces)
-- and `use_case` (what it is for).
--
--   prompt_items.cast_kind
--       'solo'   one person, the buyer (every row that exists today — the default);
--       'couple' the buyer and one partner (the category stays off behind TWINGS_COUPLE_TEMPLATES
--                until the founder decides the terms wording, docs/CAST-CATEGORIES.md §4);
--       'pet'    a pet, alone or with the buyer (the recipe's slots say which).
--
-- The column is `cast_kind` and not `cast` because CAST is a reserved word in SQL; the code calls the
-- field `cast`. Reads go through `to_jsonb(prompt_items.*)->>'cast_kind'` with a 'solo' fallback
-- (lib/prompts/repo.ts), so a database without this migration keeps serving every page as before.

alter table prompt_items
  add column if not exists cast_kind text not null default 'solo'
    constraint prompt_items_cast_kind_known check (cast_kind in ('solo', 'couple', 'pet'));

-- The two new sections read by cast, medium and status.
create index if not exists prompt_items_cast_medium_status_idx on prompt_items (cast_kind, medium, status);
