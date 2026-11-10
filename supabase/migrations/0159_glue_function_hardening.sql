-- Supabase database advisor, 2026-11-11.
--
-- 0011 function_search_path_mutable: two trigger functions from 0033 run with whatever search_path
-- the calling session has. Pin it, so a schema placed ahead of `public` cannot shadow the tables they touch.
alter function public.guard_brand_prompt() set search_path = public, pg_temp;
alter function public.release_brand_production_failure() set search_path = public, pg_temp;

-- 0028/0029 security_definer_function_executable: `brand_shortlist_enforce_collaboration_cap()` exists
-- in production only (created by hand, no migration) and is callable through /rest/v1/rpc by anon and
-- signed-in users. It is a trigger function; triggers fire regardless of EXECUTE, so nobody needs it.
-- Guarded, because a database built from these files does not have it.
do $$
begin
  if to_regprocedure('public.brand_shortlist_enforce_collaboration_cap()') is not null then
    revoke execute on function public.brand_shortlist_enforce_collaboration_cap() from public, anon, authenticated;
    alter function public.brand_shortlist_enforce_collaboration_cap() set search_path = public, pg_temp;
  end if;
end $$;
