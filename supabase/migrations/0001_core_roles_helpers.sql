-- PLAYBOOK · M0 · core migration 0001
-- Privileged publication channel + shared helper functions.
--
-- PLAN §6 (R3b): both publish RPCs are owned by a dedicated `publisher` role granted to no
-- app role. `current_user = 'publisher'` is therefore true only inside those SECURITY DEFINER
-- functions and is unforgeable from application code (no GUC involved).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'publisher') then
    create role publisher nologin noinherit;
  end if;
end
$$;

-- The migration runner must be able to hand function ownership to `publisher`.
-- (PG16+ grants ADMIN automatically to a CREATEROLE creator; this is a no-op there.)
do $$
begin
  execute format('grant publisher to %I', current_user);
exception when others then
  raise notice 'publisher membership grant skipped for %: %', current_user, sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- Localized helper: PLAN §3.9 publish gate — both locales required, non-blank.
-- ---------------------------------------------------------------------------
create or replace function is_localized_complete(p jsonb)
returns boolean
language sql
immutable
as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and coalesce(btrim(p ->> 'en'), '') <> ''
     and coalesce(btrim(p ->> 'ko'), '') <> '';
$$;

-- ---------------------------------------------------------------------------
-- Content-addressed published key helper: `{sha256}.{ext}` (PLAN §6 asset lifecycle).
-- The extension is derived from the staging key, which is authored as
-- content/rev/{revision_id}/{uuid}.{ext}.
-- ---------------------------------------------------------------------------
create or replace function asset_ext(p_key text)
returns text
language sql
immutable
as $$
  select case
           when p_key ~ '\.[A-Za-z0-9]+$' then lower(substring(p_key from '\.[A-Za-z0-9]+$'))
           else ''
         end;
$$;

-- ---------------------------------------------------------------------------
-- Shared updated_at stamp (profiles / playbooks / subscriptions).
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
