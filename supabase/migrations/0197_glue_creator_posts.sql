-- 클라우드 적용 필요 — TWINGS · glue migration 0197 — pairs with 0196 (AI creative blog posts)
--
-- Deny-all posture for browser roles (matching 0195): RLS enabled and forced with zero policies,
-- all privileges revoked from public, anon, and authenticated, and server access granted to
-- service_role only.

do $$ declare t text; begin
 foreach t in array array['creator_posts','creator_post_templates'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
