-- PLAYBOOK · core migration 0012
-- Founder direction (2026-08-15): "비디오 모델 여러개 넣을 수 있게도 설정하고 싶음.
-- seedance2.5랑 seedance2.0 둘 다 체크하고 싶으면 어떻게 해?"
--
-- §13.3-3 said "single model chip SEEDANCE 2.5 (schema keeps `model` text for later)", and later is
-- now: a real prompt is often run through more than one model — the same brief on 2.5 and on 2.0, or
-- a clip whose audio came from somewhere else entirely. One text column could hold one answer, so
-- the card's chip was a hardcoded constant rather than a fact about the row.
--
-- EXPANDED rather than renamed, because `prompt_items` is NOT empty (unlike `contests` in 0011) and
-- the site is live: a rename would 500 the gallery for the minute between this migration and the
-- deployment that understands it. `models` is added and backfilled, `model` merely loses its NOT
-- NULL so new rows need not write it, and a later migration drops it once no deployment reads it.

alter table prompt_items add column if not exists models text[] not null default '{}';

-- Every existing row keeps exactly what it had, as a one-element list.
update prompt_items
   set models = array[model]
 where cardinality(models) = 0
   and coalesce(btrim(model), '') <> '';

alter table prompt_items alter column model drop not null;

/**
 * At least one, at most four.
 *
 * The lower bound is the point of the column — a prompt nobody can run is a prompt without a model —
 * and the upper bound is the card: chips are display type on a 16:9 poster, and a row of eight would
 * be a paragraph. Four is what fits at the smallest card width, which is the only measure that
 * matters here. The VOCABULARY is not enforced in SQL on purpose: model names change monthly and a
 * CHECK constraint would make "the founder used a model we have not heard of" a migration.
 */
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prompt_items_models_size') then
    alter table prompt_items add constraint prompt_items_models_size
      check (cardinality(models) between 1 and 4);
  end if;
end
$$;
