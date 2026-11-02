-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0073 — company creatives and the price raise
-- (docs/PLATFORM-2.0.md §19.2–§19.3, founder decisions 2026-11-02)
--
-- 1. `platform_creators.payout`. The studio's own AI creative profiles (the founder's
--    @yunseolfromseoul, the ones the team registers for promotion) sell like any creative, but their
--    margin is the company's: `settle` books creator_due = 0 for them. 'external' keeps the 80% split.
--    Existing rows become 'external'; the founder's profile is switched to 'company' by hand after
--    this file (it is a production account id, so it does not belong in a migration).
-- 2. `platform_formats.royalty_krw` is now the creative's RAISE over the base price, which may be 0
--    ("기본값 아래로는 내릴 수 없고, 올리고 싶으면 올린다"). The 0059 CHECK (500~5000) widens to 0~5000.
--
-- platform_creators and platform_formats keep 0131's deny-all posture, which the new column inherits,
-- so no glue file. Readers take `payout` through `to_jsonb(row)`, so code deployed before this file
-- still settles exactly as before.
alter table platform_creators
  add column if not exists payout text not null default 'external' check (payout in ('company', 'external'));

do $$
declare
  name text;
begin
  for name in
    select c.conname from pg_constraint c
    where c.conrelid = 'platform_formats'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%royalty_krw%500%5000%'
  loop
    execute format('alter table platform_formats drop constraint %I', name);
  end loop;
end $$;

alter table platform_formats
  add constraint platform_formats_royalty_krw_range check (royalty_krw is null or royalty_krw between 0 and 5000);
