-- 클라우드 적용 필요 — TWINGS · core migration 0192 — an audited recipe revision path for the studio's OWN formats
-- (docs/CREATOR-PLATFORM.md "Recipe revisions of the studio's own formats (2026-11-25)", founder instruction 2026-11-25:
-- the test photo's leftover wording must stop applying to every buyer, and the on-sale templates get a styling block).
--
-- 0046/0059's `platform_private_format()` freezes a format template's recipe, disclosure, visibility, source and
-- author: the studio must never swap, clear or disclose a MAKER's recipe — the maker chose what is shown. A format
-- whose owner is the studio's own company-payout account (`platform_creators.payout = 'company'`, 0073) has no
-- outside maker: the studio IS the maker. For those formats only, and only through the admin operation
-- `format.reviseRecipe` (lib/creator-platform/format-revision.ts), the recipe may change, and only when the same
-- transaction has written the evidence first:
--
--   1. a `platform_audit` row (action 'format.reviseRecipe', entity = the template) — hashes and lengths only;
--   2. a `platform_format_revisions` row (below) naming that audit row and recording the recipe exactly before and
--      exactly after (the bodies live ONLY here, never in platform_audit), so a later revision can restore it;
--   3. `set_config('app.format_revision', <audit id>, true)` — transaction-local.
--
-- Same transaction = both rows carry `created_at = transaction_timestamp()` (`now()` IS the transaction's start time,
-- and both columns default to it). A row left by an earlier transaction has an earlier time and does not count.
-- Disclosure, text_visibility, source and author stay frozen for EVERY format, with or without the setting; every
-- other format's recipe stays frozen exactly as before (same exception, same message).
--
-- Safe to apply twice. Nothing in the app depends on these objects except the operation, which probes for them
-- (`formatRevisionSchemaReady`) and refuses cleanly without them.

create table if not exists platform_format_revisions (
  id uuid primary key default gen_random_uuid(),
  format_id uuid not null references platform_formats on delete restrict,
  template_id uuid not null references prompt_items on delete restrict,
  -- Like platform_audit.actor_id: a historical identifier, deliberately not a cascading profile FK.
  actor_id uuid,
  audit_id uuid not null unique references platform_audit on delete restrict,
  reason text not null check (length(reason) between 10 and 2000),
  before jsonb not null check (jsonb_typeof(before) = 'object'),
  after jsonb not null check (jsonb_typeof(after) = 'object'),
  before_sha256 text not null check (before_sha256 ~ '^[0-9a-f]{64}$'),
  after_sha256 text not null check (after_sha256 ~ '^[0-9a-f]{64}$'),
  -- The legacy single-prompt copy (`prompt_items.prompt_text`) the operation rewrites with the recipe.
  prompt_text_before text not null,
  prompt_text_after text not null,
  created_at timestamptz not null default now(),
  check (before_sha256 <> after_sha256)
);
create index if not exists platform_format_revisions_template on platform_format_revisions (template_id, created_at desc);

-- A revision is a record: a later revision supersedes it, nothing rewrites or removes it (0046's function).
drop trigger if exists platform_format_revisions_immutable on platform_format_revisions;
create trigger platform_format_revisions_immutable before update or delete on platform_format_revisions
  for each row execute function platform_immutable();

-- 0059's guard, every check kept, plus ONE narrow door for the recipe (conditions above). A setting that is not a
-- uuid, names no audit row, names one from another transaction, another template or another action, a format whose
-- owner is not the company, or a revision row that does not record exactly this change: the same exception as before.
create or replace function platform_private_format() returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  revision text;
begin
  if exists(select 1 from platform_formats f where f.template_id=new.id and
    (new.text_visibility::text<>'hidden' or new.source::text<>'yagi' or new.author_id is distinct from f.user_id
     or new.disclosure is distinct from old.disclosure)) then
    raise exception 'platform private format contract';
  end if;
  if new.recipe is distinct from old.recipe and exists(select 1 from platform_formats f where f.template_id=new.id) then
    revision := nullif(current_setting('app.format_revision', true), '');
    if revision is null or revision !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'platform private format contract';
    end if;
    if not exists(
      select 1
        from platform_formats f
        join platform_creators c on c.user_id = f.user_id
        join platform_audit a on a.id = revision::uuid
        join platform_format_revisions r on r.audit_id = a.id
       where f.template_id = new.id
         and f.status = 'accepted'
         and c.payout = 'company'
         and a.entity_id = new.id
         and a.action = 'format.reviseRecipe'
         and a.created_at = transaction_timestamp()
         and r.template_id = new.id
         and r.format_id = f.id
         and r.created_at = transaction_timestamp()
         and r.before = old.recipe
         and r.after = new.recipe
    ) then
      raise exception 'platform private format contract';
    end if;
  end if;
  return new;
end $$;
