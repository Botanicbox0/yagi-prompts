-- 클라우드 적용 필요 — TWINGS · glue migration 0193 — format recipe revision posture (pairs with 0192)
-- 0192 replaced `platform_private_format()`; its privileges and search_path are re-asserted exactly as 0131 set them
-- (a trigger function is never a PostgREST /rpc surface). The new revision record is server-only: RLS on and forced,
-- no policy, nothing for browser keys (the 0153 shape). It is append-only (0192's immutability trigger), so the
-- server role gets select and insert only.
revoke all on function platform_private_format() from public,anon,authenticated;
alter function platform_private_format() set search_path=public,pg_temp;
do $$ declare t text; begin
 foreach t in array array['platform_format_revisions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert on public.%I to service_role',t);
 end loop;
end $$;
