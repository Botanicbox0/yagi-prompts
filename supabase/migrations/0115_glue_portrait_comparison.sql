-- Cloud application required. No browser role may read originals or model results directly.
alter table identity_portrait_attempts enable row level security;
alter table identity_portrait_attempts force row level security;
revoke all on identity_portrait_attempts from public,anon,authenticated;
grant select,insert,update on identity_portrait_attempts to service_role;
