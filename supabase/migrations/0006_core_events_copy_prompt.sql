-- PLAYBOOK · M6 · core migration 0006
-- PLAN §13.2 — `/api/prompts/copy/[id]` "logs a `copy_prompt` event".
--
-- The funnel's type whitelist lives in two places that must agree: the literal union in
-- `lib/events/track.ts` (so a typo is a type error) and this CHECK (so a bug cannot write a type
-- the analytics never expects to read). §6 shipped five; the copy endpoint is the sixth and the
-- first genuinely NEW funnel moment since M3 — it is the prompts surface's conversion signal.
--
-- Additive by construction: the constraint is replaced, never the column, and every existing row
-- satisfies the wider list. 0002 is not touched (migrations are append-only).

alter table events drop constraint if exists events_type_check;

alter table events add constraint events_type_check
  check (type in (
    'view_playbook',
    'hit_lock',
    'start_checkout',
    'unlock_success',
    'hire_click',
    'copy_prompt'
  ));
