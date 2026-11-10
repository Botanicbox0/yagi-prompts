-- 클라우드 적용 필요 — TWINGS · glue migration 0153 — render_slot_inputs posture (pairs with 0079)
-- RLS on with no policies = closed to every browser key. The make routes, the payment route and the
-- render pass all run on the app's server role (the 0150/0152 shape).
do $$ declare t text; begin
 foreach t in array array['render_slot_inputs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
