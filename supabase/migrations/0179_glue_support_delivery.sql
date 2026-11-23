-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0179 — pairs with 0178
-- Resets any Supabase default table privileges before granting least-privilege server access.
-- RLS enabled and forced with zero policies: no direct anon or authenticated access.

do $$
declare t text;
begin
  foreach t in array array['team_notice_deliveries', 'consumer_support_messages', 'support_synced_replies'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$$;

grant select, insert, update on public.team_notice_deliveries to service_role;
grant select, insert on public.consumer_support_messages to service_role;
-- Column-level UPDATE only on transcript so the 365-day privacy purge can scrub transcripts
-- without allowing rewrites of message body or author attribution.
grant update (transcript) on public.consumer_support_messages to service_role;
grant select, insert on public.support_synced_replies to service_role;
