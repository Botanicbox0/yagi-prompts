-- CLOUD APPLICATION REQUIRED with 0060. platform_creators keeps 0131's deny-all posture (the new
-- columns inherit it); only the two trigger functions need their execute grants and search path.
revoke all on function maker_template_handle() from public,anon,authenticated;
revoke all on function maker_profile_sync() from public,anon,authenticated;
alter function maker_template_handle() set search_path=public,pg_temp;
alter function maker_profile_sync() set search_path=public,pg_temp;
