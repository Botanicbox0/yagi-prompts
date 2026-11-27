-- 클라우드 적용 필요 — TWINGS · core migration 0206 — 0192's "same transaction" becomes an exact transaction id
-- (docs/CREATOR-PLATFORM.md "Recipe revisions of the studio's own formats"). Apply after 0192/0193, then 0207.
--
-- 0192 lets a studio-owned format's recipe change only when the same transaction first wrote the `platform_audit`
-- row ('format.reviseRecipe') and the `platform_format_revisions` row and set `app.format_revision`. It decided "same
-- transaction" by `created_at = transaction_timestamp()` on both rows. That is a proxy: two transactions can start at
-- the same instant, and on a coarse clock (local PGlite) evidence an earlier transaction left looks fresh. This
-- migration keeps the meaning and makes it exact:
--
--   * `txid bigint` on both evidence tables — nullable, NO default, so neither table is rewritten and every row that
--     exists today stays NULL. NULL never equals `txid_current()`, so no row written before 0206 can count.
--   * `platform_stamp_txid()`, a BEFORE INSERT trigger on both tables, sets `txid := txid_current()` on every new row
--     and overwrites whatever the writer sent: a writer cannot choose it. Nothing can change it afterwards either —
--     both tables already refuse every UPDATE and DELETE (0046 `platform_audit_immutable`, 0192
--     `platform_format_revisions_immutable`, both `platform_immutable()`). No other BEFORE INSERT trigger exists on
--     either table; one added later must not write `txid`.
--   * `txid_current()` is the TOP-LEVEL transaction id (64-bit, epoch-extended, not reused while the cluster lives),
--     the same inside a savepoint. The row's `xmin` is not used: a row inserted inside a savepoint carries the
--     subtransaction's id and would refuse a legitimate revision.
--   * `platform_private_format()` is 0192's function verbatim plus two lines: `a.txid = txid_current()` and
--     `r.txid = txid_current()`. 0192's two `created_at = transaction_timestamp()` lines STAY: inside one transaction
--     they are always true (both columns default to `now()`), so they refuse nothing new, and they keep the rule at
--     least as strict as 0192 in the one case a transaction id alone could repeat — a logical dump restored into a
--     new cluster, whose id counter starts again below the ids the old rows carry. Same exception, same message.
--
-- Safe to apply twice. The app needs no change: the operation (lib/creator-platform/format-revision.ts) inserts both
-- rows with explicit column lists that never name `txid`, and its schema probe still finds `app.format_revision` in
-- the function body. Before 0206 the 0192 rule applies; after it, 0192's rule and the transaction id together.

alter table platform_audit add column if not exists txid bigint;
alter table platform_format_revisions add column if not exists txid bigint;

create or replace function platform_stamp_txid() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.txid := txid_current();
  return new;
end $$;

drop trigger if exists platform_audit_txid on platform_audit;
create trigger platform_audit_txid before insert on platform_audit
  for each row execute function platform_stamp_txid();
drop trigger if exists platform_format_revisions_txid on platform_format_revisions;
create trigger platform_format_revisions_txid before insert on platform_format_revisions
  for each row execute function platform_stamp_txid();

-- 0192's guard, every check kept; "same transaction" now also requires the stamped top-level transaction id.
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
         and a.txid = txid_current()
         and r.template_id = new.id
         and r.format_id = f.id
         and r.created_at = transaction_timestamp()
         and r.txid = txid_current()
         and r.before = old.recipe
         and r.after = new.recipe
    ) then
      raise exception 'platform private format contract';
    end if;
  end if;
  return new;
end $$;
