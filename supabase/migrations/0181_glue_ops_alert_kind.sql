-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0181 — pairs with 0180 (ops_alert kind on team_notice_deliveries)
-- Re-asserts 0179 deny-all RLS and least-privilege server access on `team_notice_deliveries`.
-- No new tables, no policies, and no DELETE privilege on the outbox.

do $$ begin
  if to_regclass('public.team_notice_deliveries') is null then
    return;
  end if;
  execute 'alter table public.team_notice_deliveries enable row level security';
  execute 'alter table public.team_notice_deliveries force  row level security';
  execute 'revoke all on public.team_notice_deliveries from public, anon, authenticated, service_role';
  execute 'grant select, insert, update on public.team_notice_deliveries to service_role';
end $$;
