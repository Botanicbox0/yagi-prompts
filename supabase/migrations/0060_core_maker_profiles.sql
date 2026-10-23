-- CLOUD APPLICATION REQUIRED (with 0143). docs/PLATFORM-2.0.md §7.5·§14.1 — a template maker's public
-- handle, short bio and an explicit opt-in. Nothing is public until the maker turns `public_profile`
-- on; no handles are seeded. Without this file the catalogue keeps working (lib/makers/profile.ts
-- checks for the columns) and simply shows no maker credits.
alter table platform_creators
 add column if not exists handle text unique check(handle is null or handle ~ '^[a-z0-9_]{3,20}$'),
 add column if not exists public_profile boolean not null default false,
 add column if not exists bio text check(bio is null or char_length(bio) between 1 and 200);
alter table platform_creators add constraint platform_creators_public_needs_handle
 check(not public_profile or handle is not null);

-- A maker template is a public `source='yagi'` row with an `author_id` (0046). Its `author_handle`
-- is the maker's handle only while the maker is active and has opted in, and null otherwise — no
-- matter which path wrote the row (the accept step, the admin editor, a backfill).
create function maker_template_handle() returns trigger language plpgsql as $$
begin
 if new.author_id is not null and new.source::text = 'yagi' and new.audience = 'public'
    and exists(select 1 from platform_creators c where c.user_id = new.author_id) then
  new.author_handle := (select c.handle from platform_creators c
                         where c.user_id = new.author_id and c.active and c.public_profile);
 end if;
 return new;
end $$;
create trigger maker_template_handle before insert or update on prompt_items
 for each row execute function maker_template_handle();

-- Turning the profile on or off (or a handle change, or a revoke) rewrites the credit on every
-- template the maker has. The row trigger above recomputes the same value on the way in.
create function maker_profile_sync() returns trigger language plpgsql as $$
begin
 if new.handle is distinct from old.handle or new.public_profile is distinct from old.public_profile
    or new.active is distinct from old.active then
  update prompt_items
     set author_handle = case when new.active and new.public_profile then new.handle end
   where author_id = new.user_id and source::text = 'yagi' and audience = 'public'
     and author_handle is distinct from case when new.active and new.public_profile then new.handle end;
 end if;
 return null;
end $$;
create trigger maker_profile_sync after update on platform_creators
 for each row execute function maker_profile_sync();
