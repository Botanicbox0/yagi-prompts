-- Cloud application required. Browser clients authenticate only; no table/RPC access.
-- Service-role queries must STILL perform explicit organization membership checks in service.ts.
do $$ declare t text; begin
  foreach t in array array['brand_organizations','brand_memberships','brand_invites','brand_projects','brand_content_versions','brand_content_decisions','brand_messages','brand_attachments','brand_posts','brand_post_measurements','brand_reports','brand_workspace_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select, insert on public.%I to service_role',t);
  end loop;
end $$;
grant update(status,role) on brand_memberships to service_role;
grant update(accepted_at,accepted_by,revoked_at) on brand_invites to service_role;
grant update(status,revision,updated_at) on brand_projects to service_role;
grant update(review_revision) on brand_content_versions to service_role;
grant update(status,sha256) on brand_attachments to service_role;
grant update(verification,metrics_source,measured_at,views,likes,comments,shares,saves,metric_revision) on brand_posts to service_role;
revoke all on function brand_workspace_immutable() from public,anon,authenticated,service_role;
revoke all on function brand_content_version_guard() from public,anon,authenticated,service_role;
revoke all on function brand_attachment_guard() from public,anon,authenticated,service_role;
