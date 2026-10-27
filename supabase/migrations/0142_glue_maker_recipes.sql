-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0142 — maker recipe posture (pairs with 0059)
-- A maker's reference files, the recipe a job ran and every carousel frame are private: no browser
-- key reads or writes them; the app's server role does everything (the 0131 shape).
do $$ declare t text; begin
 foreach t in array array['platform_format_assets','render_job_recipes','render_job_outputs'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
-- prompt_items.recipe needs nothing new: 0102 already denies the whole table to every browser role.
