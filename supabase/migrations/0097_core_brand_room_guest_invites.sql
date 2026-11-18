-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0097 — project room guest invitations (docs/BRAND-ROOMS-FEEDBACK.md §12)
--
-- Apply this file (and 0170) BEFORE turning on BRAND_ROOM_INVITES=on. With the flag off nothing writes or
-- reads the new columns, so the code can ship first. No new table: a brand's invitation to one project is
-- a `brand_invites` row with `project_id` (0031) and `can_comment` (0034), accepted into
-- `brand_project_members` exactly like the team's.
--
--   scope check   a project invitation was the team's only (`issued_by_studio`). Now a brand owner or
--                 editor may issue one too; it is still a viewer seat on one project. Owner invitations
--                 stay the team's.
--   accepted_email  the e-mail of the account that accepted, as it was then. A project invitation may be
--                 accepted by an account whose e-mail differs from the invited address (single use), so
--                 the inviter's list shows who actually got in. Null for every row accepted before.
--   mail_state    the invitation mail: 'sent', 'failed' (the provider refused or could not be reached) or
--                 'skipped' (no mailer configured). Null: no mail was tried (the team's copied link, or a
--                 row from before). mail_sent_at is when it went out.
--   target_kind / target_id  the draft ('review') or storyboard the invitation was sent from, so the
--                 accepted guest lands on it. Both or neither, and only on a project invitation. Not a
--                 foreign key (two tables); the landing re-checks it like any other link.
--
-- Vocabulary mirrors lib/brand-rooms/invites.ts.

alter table brand_invites drop constraint brand_invites_scope_check;
alter table brand_invites add constraint brand_invites_scope_check check(
  (role <> 'owner' or issued_by_studio) and (project_id is null or role = 'viewer'));

alter table brand_invites
  add column accepted_email text check (accepted_email is null or (accepted_email = lower(accepted_email) and length(accepted_email) <= 254)),
  add column mail_state text check (mail_state in ('sent', 'failed', 'skipped')),
  add column mail_sent_at timestamptz,
  add column target_kind text check (target_kind in ('review', 'storyboard')),
  add column target_id uuid;

alter table brand_invites add constraint brand_invites_target_scope check (
  (target_kind is null) = (target_id is null) and (target_kind is null or project_id is not null));

-- The project's pending invitations: the dialog's list and the per-project cap.
create index brand_invites_project_pending on brand_invites (project_id, created_at desc)
  where project_id is not null and accepted_at is null and revoked_at is null;
