-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0145 — AI creative profile posture (pairs with 0065)
-- Works, recipe opens and access tokens are server-only: no browser key reads or writes them; the
-- app's server role does everything (the 0131/0142 shape). platform_creators keeps 0131's deny-all
-- posture, and the new columns inherit it.
do $$ declare t text; begin
 foreach t in array array['maker_works','recipe_unlocks','maker_tokens'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
