-- 클라우드 적용 필요. No direct browser access or arbitrary quota editing.
revoke all on brand_production_contracts,brand_production_templates,brand_production_reservations from anon,authenticated,service_role;
grant select,insert on brand_production_contracts,brand_production_templates,brand_production_reservations to service_role;
grant update(enabled,revision) on brand_production_contracts to service_role;
grant update(released_at) on brand_production_reservations to service_role;
do $$ declare t text; begin
 foreach t in array array['brand_production_contracts','brand_production_templates','brand_production_reservations'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
 end loop;
end $$;
