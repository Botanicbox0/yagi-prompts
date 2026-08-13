-- PLAYBOOK · M9 · SUPABASE GLUE migration 0104  (NOT applied by the PGlite test harness)
-- PLAN §6 security posture, extended to §14's three new tables.
--
--   "RLS ENABLED AND FORCED on every table with no policies (deny-all for anon/authenticated)."
--
-- `contest_entries` is the second table a non-admin can cause rows to appear in (after
-- `prompt_items`), and the first that stores a personal link — `sns_url` is a real identity handle
-- that the entrant chose to publish. Deny-all is therefore doing more work here than anywhere else
-- on the site: the browser's Supabase client is auth-only, every read and write runs in a server
-- action under the service role, and a PENDING entry's `sns_url` is reachable through exactly one
-- code path (the admin moderation queue) rather than through PostgREST.
--
-- Deliberately NO RLS policies at all: deny-all is their absence, never a permissive one. (The
-- migration test greps every file for the statement that would create one, so this sentence
-- describes the omission without spelling it.)
--
-- Split into its own file because 0100/0102 already shipped (migrations are append-only); the
-- migration test concatenates every `*_glue_*` file and asserts coverage for EVERY table, so the
-- three halves are checked as one posture.
--
-- 0103's hardening lesson, applied by having nothing to apply it to: migration 0007 creates NO new
-- functions, so there is no new `public` function for Supabase's ALTER DEFAULT PRIVILEGES to hand
-- anon/authenticated over PostgREST `/rpc`, and no new `search_path` to pin. Phase derivation lives
-- in TypeScript (`lib/contests/phase.ts`) precisely because it is a read-time question.

do $$
declare
  t text;
begin
  foreach t in array array['contests', 'contest_entries', 'contest_entry_writes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
