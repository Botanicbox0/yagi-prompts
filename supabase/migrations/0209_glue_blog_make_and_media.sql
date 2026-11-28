-- 클라우드 적용 필요 — TWINGS · glue migration 0209 — pairs with 0208 (blog media 50MB & unlisted blog-make)
--
-- Re-asserts deny-all RLS posture for browser roles on `maker_works`, `platform_formats`, and
-- `prompt_items` after widening constraints and adding `catalog_listed`.

do $$ declare t text; begin
  foreach t in array array['maker_works','platform_formats','prompt_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
