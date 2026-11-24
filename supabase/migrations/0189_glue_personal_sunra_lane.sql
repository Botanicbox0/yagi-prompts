-- 클라우드 적용 필요 — TWINGS · glue migration 0189 — personal Sunra lane posture (pairs with 0188)
-- RLS on with no policies = closed to every browser key. The order route, the render pass and the admin
-- operations run on the app's server role (the 0153 shape). render_slot_inputs gained two columns in 0188;
-- its posture (0153) is re-asserted, nothing more.
do $$ declare t text; begin
 foreach t in array array['adult_confirmations','render_provider_state','render_slot_inputs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
