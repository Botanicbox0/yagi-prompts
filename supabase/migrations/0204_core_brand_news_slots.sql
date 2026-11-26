-- 클라우드 적용 필요 — TWINGS · core migration 0204 — brand home news follow-ups (slice N2): team_home slot
--
-- Extends `brand_announcements.slot` (0196) to support `'team_home'` (the "야기 팀과" workspace home) alongside `'home'`
-- (the "직접 만들기" workspace home).
--
-- Notes on existing 0196 guarantees:
--   * `brand_announcements_one_live` (`create unique index ... on brand_announcements (slot) where status = 'live'`)
--     already enforces at most one live announcement PER slot.
--   * `updated_at timestamptz not null default now()` already exists on `brand_announcements` and is updated on every
--     save, publish, and end (used as the publish staleness fingerprint `expectedUpdatedAt` in slice N2).
--
-- Every existing row (`slot = 'home'`) passes the updated check. Safe to apply while pre-N2 code serves: pre-N2 reads
-- filter `slot = 'home'`, and pre-N2 saves only insert `slot = 'home'`. Safe to deploy N2 code first: the server checks
-- `brandNewsSlotsReady` (pg_constraint lookup) and keeps the `'team_home'` slot and draft deletion closed until 0204
-- is applied. Re-runnable: every statement is guarded or idempotent.

set lock_timeout = '3s';

alter table brand_announcements drop constraint if exists brand_announcements_slot;
alter table brand_announcements
  add constraint brand_announcements_slot check (slot in ('home', 'team_home')) not valid;
alter table brand_announcements validate constraint brand_announcements_slot;

create unique index if not exists brand_announcements_one_live on brand_announcements (slot) where status = 'live';

-- Database backstop for 0205's DELETE grant: only drafts may ever be deleted from brand_announcements.
create or replace function brand_announcements_draft_delete_only() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status <> 'draft' then
    raise exception 'brand_announcements: only a draft can be deleted'
      using errcode = '23514';
  end if;
  return old;
end;
$$;

drop trigger if exists brand_announcements_draft_delete_only on brand_announcements;
create trigger brand_announcements_draft_delete_only
  before delete on brand_announcements
  for each row execute function brand_announcements_draft_delete_only();
