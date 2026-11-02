-- 클라우드 적용 필요 (after 0035_core_brand_organization_logo.sql). Browser roles receive no table access.
-- Logo rows are insert-only for the server role; only the organization's current-logo pointer moves.
revoke all on brand_organization_logos from anon,authenticated,service_role;
grant select,insert on brand_organization_logos to service_role;
grant update(logo_id,logo_revision) on brand_organizations to service_role;
do $$ declare t text; begin
 foreach t in array array['brand_organization_logos'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
 end loop;
end $$;
