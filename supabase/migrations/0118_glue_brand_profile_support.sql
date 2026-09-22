-- 클라우드 적용 필요. No direct browser role access.
revoke all on brand_support_messages from anon,authenticated,service_role;
grant select,insert on brand_support_messages to service_role;
grant update(name,website,description,contact_email,profile_revision) on brand_organizations to service_role;

do $$ declare t text; begin
 foreach t in array array['brand_support_messages'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
 end loop;
end $$;
