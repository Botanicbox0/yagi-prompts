-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0058 — designated invitations (docs/PLATFORM-2.0.md §16.5, §17.3, 2026-10-23)
--
-- A brand invites a creator from the creator pool (/brand/creators). The invitation is the existing
-- one-person link (0047), now able to name the one account allowed to accept it:
--
--   campaign_participant_invites.invited_user_id
--                       NULL for the links a brand shares by hand (unchanged). Set for an invitation
--                       sent from the pool: only that signed-in account may accept it. The same
--                       request also adds the account to campaign_targets (0056), which is what shows
--                       an `invited` campaign to it. Immutable like the rest of the invitation.
--   one live named invitation per person and campaign; revoking frees the slot for a new one.
--
-- No new grants: 0132 gives the server role INSERT on the whole table and UPDATE only on the
-- acceptance and revocation columns, so the new column is written once, at insert. Readers check
-- for the column, so code deployed before this file still answers (the pool cannot invite yet).

alter table campaign_participant_invites add column if not exists invited_user_id uuid references profiles(id);

create unique index if not exists campaign_participant_invites_designated
  on campaign_participant_invites (campaign_id, invited_user_id)
  where invited_user_id is not null and revoked_at is null;

-- Keeps the pinned search_path 0136 set: CREATE OR REPLACE would otherwise clear it.
create or replace function guard_campaign_collaboration_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$ begin
 if tg_op='DELETE' then raise exception 'participant collaboration record immutable';end if;
 if tg_table_name='campaign_participant_files' then
  if (to_jsonb(old)-'status') is distinct from (to_jsonb(new)-'status') or old.status='ready' then raise exception 'participant file immutable';end if;
 elsif tg_table_name='campaign_participant_invites' then
  if (old.id,old.campaign_id,old.token_hash,old.email,old.created_by,old.request_id,old.expires_at,old.created_at,old.invited_user_id)
   is distinct from (new.id,new.campaign_id,new.token_hash,new.email,new.created_by,new.request_id,new.expires_at,new.created_at,new.invited_user_id)
   or old.accepted_at is not null and (old.accepted_by,old.application_id,old.accepted_fingerprint,old.accepted_terms_version,old.accepted_terms_snapshot,old.accepted_at) is distinct from (new.accepted_by,new.application_id,new.accepted_fingerprint,new.accepted_terms_version,new.accepted_terms_snapshot,new.accepted_at)
   or old.revoked_at is not null and old.revoked_at is distinct from new.revoked_at then raise exception 'participant invitation immutable'; end if;
 else raise exception 'participant collaboration record immutable'; end if;
 return new;
end $$;
