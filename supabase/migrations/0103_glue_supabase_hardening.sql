-- PLAYBOOK · SUPABASE GLUE migration 0103 — cloud hardening (found by security advisors, 2026-08-13)
--
-- 1. Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on new public-schema functions to
--    anon/authenticated (the PostgREST /rpc surface). 0100 revoked only from `public`, which does
--    not cover those direct grants — without this, anon could invoke the SECURITY DEFINER
--    publish RPCs over HTTP. PGlite has no anon/authenticated roles, so only the cloud sees it.
revoke execute on function prepare_publish(uuid)              from anon, authenticated;
revoke execute on function publish_revision(uuid, uuid, text) from anon, authenticated;
revoke execute on function canonical_manifest(uuid)           from anon, authenticated;

-- 2. Pin search_path on trigger/helper functions (advisor lint 0011). The publish RPCs already pin it.
alter function set_updated_at()             set search_path = public, pg_temp;
alter function is_localized_complete(jsonb) set search_path = public, pg_temp;
alter function asset_ext(text)              set search_path = public, pg_temp;
alter function guard_playbook_revisions()   set search_path = public, pg_temp;
alter function guard_steps()                set search_path = public, pg_temp;
alter function guard_blocks()               set search_path = public, pg_temp;
alter function guard_publish_assets()       set search_path = public, pg_temp;
alter function guard_playbooks()            set search_path = public, pg_temp;
