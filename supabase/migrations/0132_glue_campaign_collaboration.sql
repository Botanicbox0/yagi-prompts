-- 클라우드 적용 필요. No direct browser access; application services authorize every operation.
do $$ declare t text;begin
 foreach t in array array['campaign_collaboration_links','campaign_participant_invites','campaign_participant_messages','campaign_participant_files','campaign_participant_access_audit'] loop
 execute format('revoke all on %I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert on %I to service_role',t);
 end loop;
end $$;
grant update(revoked_at,accepted_by,application_id,accepted_fingerprint,accepted_terms_version,accepted_terms_snapshot,accepted_at) on campaign_participant_invites to service_role;
grant update(status) on campaign_participant_files to service_role;
