-- 클라우드 적용 필요. Browser roles receive no table access; server guards every operation.
revoke all on brand_project_members,brand_contract_documents,brand_contract_sharing_events from anon,authenticated,service_role;
grant select,insert on brand_project_members,brand_contract_documents,brand_contract_sharing_events to service_role;
grant update(status) on brand_project_members to service_role;
grant update(shared,revision) on brand_contract_documents to service_role;
grant update(client_visible) on brand_projects to service_role;

do $$ declare t text; begin
 foreach t in array array['brand_project_members','brand_contract_documents','brand_contract_sharing_events'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
 end loop;
end $$;
