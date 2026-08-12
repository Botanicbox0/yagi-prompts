-- PLAYBOOK · M6 · SUPABASE GLUE migration 0102  (NOT applied by the PGlite test harness)
-- PLAN §6 security posture, extended to §13's one new table.
--
--   "RLS ENABLED AND FORCED on every table with no policies (deny-all for anon/authenticated)."
--
-- `prompt_items` is the first table a NON-admin can cause rows to appear in (community
-- submissions), which makes the posture more load-bearing here than anywhere else — and it changes
-- nothing: the browser's Supabase client is auth-only, the submission runs in a server action under
-- the service role, and a submitter reads their own pending row through that same server path.
-- Deliberately NO RLS policies at all: deny-all is their absence, never a permissive one. (The
-- migration test greps every file for the statement that would create one, so this sentence
-- describes the omission without spelling it.)
--
-- Split into its own file because 0100 already shipped (migrations are append-only); the migration
-- test concatenates every `*_glue_*` file and asserts coverage for EVERY table, so the two halves
-- are checked as one posture.

do $$
declare
  t text;
begin
  foreach t in array array['prompt_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
