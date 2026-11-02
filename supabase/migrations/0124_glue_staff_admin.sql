-- 클라우드 적용 필요 (after 0038_core_staff_admin.sql). docs/SETUP.md §4.
-- `profiles` is FORCE row level security with no policies, so the SECURITY DEFINER functions of 0038
-- only write it when their owner bypasses RLS. Without that the backfill and every sync would update
-- zero rows without an error; fail the migration instead.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_roles r on r.oid = p.proowner
     where p.proname in ('sync_staff_admin', 'staff_admin_eligible', 'profiles_admin_provenance', 'auth_users_sync_staff_admin')
       and not (r.rolbypassrls or r.rolsuper)
  ) then
    raise exception 'staff admin functions must be owned by a role that bypasses RLS on profiles';
  end if;
end
$$;

-- No browser role reaches the policy or the sync over /rpc. The trigger functions need no grant to fire.
revoke all on function is_twings_staff_email(text) from public, anon, authenticated;
revoke all on function staff_admin_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function sync_staff_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function profiles_admin_provenance() from public, anon, authenticated, service_role;
revoke all on function auth_users_sync_staff_admin() from public, anon, authenticated, service_role;
revoke all on function lock_staff_admin(uuid) from public, anon, authenticated, service_role;

-- Re-run the backfill now that the owner check passed (idempotent).
do $$
declare
  r record;
begin
  for r in select id from profiles loop
    perform sync_staff_admin(r.id);
  end loop;
end
$$;
