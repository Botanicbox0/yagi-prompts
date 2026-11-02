-- PLAYBOOK · core migration 0018 — a fixed won price per template (founder, 2026-09-07: "한국어로
-- 제작할때 비용이 달러로 표시되면 안될 것 같아").
--
-- A Korean page shows a FIXED won price, never a converted dollar: prices are set, not computed,
-- so the number a reader sees today is the number they pay when the domestic PG lands. The won
-- price sits beside the USD one on the row and the admin editor; a row without one falls back to
-- the x,900 rule in lib/twings/products.ts (USD × 1,400 rounded up to the next thousand, minus a
-- hundred: $4 → 5,900원, $7 → 9,900원, $2 → 2,900원), which is also what this migration writes
-- into the rows that already carry a dollar price — the founder edits from there.
alter table prompt_items
  add column if not exists price_krw integer not null default 0
    constraint prompt_items_price_krw_non_negative check (price_krw >= 0);

update prompt_items
   set price_krw = greatest(900, (ceil((price_cents * 14.0) / 1000.0)::int * 1000) - 100)
 where price_cents > 0 and price_krw = 0;
