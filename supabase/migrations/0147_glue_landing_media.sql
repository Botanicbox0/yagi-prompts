-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0147 — landing_media posture (pairs with 0067)
-- No browser key reads or writes overrides: the marketing pages read them on the app's server role
-- (cached, tag `landing-media`) and only /admin/do writes them (the 0146 shape).
do $$ declare t text; begin
 foreach t in array array['landing_media'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
