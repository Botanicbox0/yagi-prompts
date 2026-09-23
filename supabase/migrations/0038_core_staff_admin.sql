-- 클라우드 적용 필요 (then 0124_glue_staff_admin.sql). docs/SETUP.md §4.
-- Every account whose email the AUTH SERVER confirmed on exactly @yagiworkshop.xyz is an admin.
--
-- The one input is `auth.users` (email, email_confirmed_at, deleted_at, banned_until), written by
-- GoTrue only. A ban revokes the grant at the ban write; an unban (or any later auth write after a
-- timed ban expires, e.g. the next sign-in) grants it again.
-- `profiles.email`, user metadata and anything a browser sends are never read. The rule is mirrored
-- by `isStaffEmail()` in lib/brands/workspace/staff.ts; tests/auth/staff-admin.test.ts holds both
-- to the same corpus.
--
-- Provenance keeps intentional admins: `admin_source` is 'manual' for every admin that existed before
-- this file and for any later SQL promotion, 'staff_email' for a grant made here. Only a
-- 'staff_email' grant is ever revoked (email moved off the domain, confirmation gone, user deleted).
--
-- The auth.users columns are read through to_jsonb so the PGlite stub (`id` only) still migrates:
-- there, nobody is eligible.

alter table profiles add column if not exists admin_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_admin_source_check') then
    alter table profiles add constraint profiles_admin_source_check check (admin_source in ('manual', 'staff_email'));
  end if;
end $$;
update profiles set admin_source = 'manual' where is_admin and admin_source is null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_admin_source_matches') then
    alter table profiles add constraint profiles_admin_source_matches check ((admin_source is not null) = is_admin);
  end if;
end $$;

-- Exact domain, one '@', non-empty local part, printable ASCII only (no look-alike code points,
-- no subdomain, no suffix). Surrounding whitespace and case are ignored.
create or replace function is_twings_staff_email(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(
    (select v ~ '^[!-~]+$' and lower(v) ~ '^[^@]+@yagiworkshop\.xyz$'
       from (select regexp_replace(p, '^[[:space:]]+|[[:space:]]+$', '', 'g') as v) t),
    false);
$$;

create or replace function staff_admin_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select is_twings_staff_email(u ->> 'email')
       and nullif(u ->> 'email_confirmed_at', '') is not null
       and nullif(u ->> 'deleted_at', '') is null
       and (nullif(u ->> 'banned_until', '') is null or (u ->> 'banned_until')::timestamptz <= now())
      from (select to_jsonb(a) as u from auth.users a where a.id = p_user) s
  ), false);
$$;

create or replace function sync_staff_admin(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if staff_admin_eligible(p_user) then
    update profiles set is_admin = true, admin_source = 'staff_email' where id = p_user and not is_admin;
  else
    update profiles set is_admin = false where id = p_user and admin_source = 'staff_email';
  end if;
end
$$;

-- Serializes the two trigger paths for one user (see below). Transaction-scoped advisory lock: needs
-- no privilege on auth.users (a row lock there would need UPDATE on a GoTrue-owned table).
create or replace function lock_staff_admin(p_user uuid)
returns void
language sql
volatile
set search_path = pg_catalog, pg_temp
as $$
  select pg_advisory_xact_lock(hashtext('twings_staff_admin'), hashtext(p_user::text));
$$;

-- profiles: a new row is promoted when its auth user is already eligible (OAuth logins arrive
-- confirmed); any other promotion is 'manual'; a demotion clears the source. No exception handler:
-- if the eligibility read fails, the profile insert fails with it (the auth callback already treats
-- a failed insert as "retry on next login"), rather than creating a row that silently skipped policy.
--
-- Race (READ COMMITTED): a first profile insert racing an auth.users change for the same user. Without
-- a lock the insert could read the old, eligible auth row while the auth trigger finds no profile yet,
-- and a stale 'staff_email' grant would commit. Both paths take `lock_staff_admin` first and hold it
-- to commit. Whoever waits reads afterwards in a NEW statement (fresh snapshot: the plpgsql functions
-- are volatile), so it sees the other side's committed row: the insert sees the new auth row, or the
-- auth trigger's sync sees the new profile and revokes.
create or replace function profiles_admin_provenance()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_admin then
      new.admin_source := coalesce(new.admin_source, 'manual');
    else
      perform lock_staff_admin(new.id);
      if staff_admin_eligible(new.id) then
        new.is_admin := true;
        new.admin_source := 'staff_email';
      else
        new.admin_source := null;
      end if;
    end if;
  elsif not new.is_admin then
    new.admin_source := null;
  elsif not old.is_admin and new.admin_source is not distinct from old.admin_source then
    new.admin_source := 'manual';
  elsif new.admin_source is null then
    new.admin_source := coalesce(old.admin_source, 'manual');
  end if;
  return new;
end
$$;

drop trigger if exists profiles_admin_provenance on profiles;
create trigger profiles_admin_provenance
  before insert or update of is_admin, admin_source on profiles
  for each row execute function profiles_admin_provenance();

-- auth.users: signup, confirmation, email change, soft delete. Fail closed, deliberately: the sync
-- runs in the same transaction as GoTrue's write and has no exception handler, so if it fails the
-- auth change itself rolls back. An email can never leave the domain (or lose its confirmation)
-- while a 'staff_email' grant survives it. The cost is that such a failure blocks that auth write
-- until fixed; nothing is logged here beyond Postgres' own error.
create or replace function auth_users_sync_staff_admin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform lock_staff_admin(new.id);
  perform sync_staff_admin(new.id);
  return null;
end
$$;

drop trigger if exists twings_sync_staff_admin on auth.users;
create trigger twings_sync_staff_admin
  after insert or update on auth.users
  for each row execute function auth_users_sync_staff_admin();

revoke all on function staff_admin_eligible(uuid) from public;
revoke all on function sync_staff_admin(uuid) from public;
revoke all on function profiles_admin_provenance() from public;
revoke all on function auth_users_sync_staff_admin() from public;
revoke all on function lock_staff_admin(uuid) from public;

-- Existing accounts: promote every confirmed team account that is not an admin yet. No per-user lock
-- here: advisory locks share the lock table, and until this migration commits no other session can
-- see the triggers anyway.
do $$
declare
  r record;
begin
  for r in select id from profiles loop
    perform sync_staff_admin(r.id);
  end loop;
end
$$;
