-- 클라우드 적용 필요 — TWINGS · glue migration 0211 — pairs with 0210 (maker work upload leases)
--
-- Enforces deny-all RLS posture for browser roles on `maker_work_uploads`.

do $$ declare t text; begin
  foreach t in array array['maker_work_uploads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
