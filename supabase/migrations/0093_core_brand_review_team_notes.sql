-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0093 — team notes on review items
-- (docs/BRAND-ROOMS-FEEDBACK.md §5, slice N1).
--
-- A note on a draft that only the YAGI team reads.
--
--   brand_studio_review_comments (+)  visibility  'public' (every reader, as before) | 'team' (the admin page only)
--
-- Rules the service keeps (lib/brand-studio/review.ts) and this file backs:
--   * only the team writes a team note: `team` requires author_role = 'studio' and no guest name;
--   * a reply takes its thread's value; a team note leaves no room line, no Slack notice and no alert;
--   * every brand, room and share-link read leaves team notes out; only the admin page reads them;
--   * an open team note carried to a new version stays team.
--
-- Safe on the live table: a column with a constant default (no rewrite), and two checks every existing row
-- already satisfies (all of them become 'public'). Safe to deploy the code first: the server looks for this
-- column (`teamNotesReady`) and, until it exists, reads exactly as before and refuses a team note.
--
-- Pairs with glue 0166 (re-asserts the table's posture from 0155; a new column needs no new grant).

alter table brand_studio_review_comments
  add column if not exists visibility text not null default 'public';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_visibility') then
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_visibility
      check (visibility in ('public', 'team'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_team_author') then
    -- Only the YAGI team writes a team note; a share-link guest or a brand member never does.
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_team_author
      check (visibility = 'public' or (author_role = 'studio' and guest_name is null));
  end if;
end $$;
