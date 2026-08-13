-- PLAYBOOK · M10 · SUPABASE GLUE migration 0105  (NOT applied by the PGlite test harness)
-- PLAN §6 security posture, extended to §15's three new tables.
--
--   "RLS ENABLED AND FORCED on every table with no policies (deny-all for anon/authenticated)."
--
-- `prompt_unlocks` is a per-person reading history, `cookie_ledger` is a per-person spending
-- record, and `cookie_purchase_events` is a per-person payment trail — between them they say who
-- paid attention to what, and when, and with money. None has any reason to be reachable through
-- PostgREST at all: the browser's Supabase client is auth-only, and every wallet read and unlock
-- write runs in a server action under the service role, inside one `transaction()`
-- (lib/cookies/repo.ts).
--
-- Deliberately NO RLS policies at all: deny-all is their absence, never a permissive one. (The
-- migration test greps every file for the statement that would create one, so this sentence
-- describes the omission without spelling it.)
--
-- Split into its own file because 0100/0102/0104 already shipped (migrations are append-only); the
-- migration test concatenates every `*_glue_*` file and asserts coverage for EVERY table, so the
-- four halves are checked as one posture.
--
-- 0103's hardening lesson, applied by having nothing to apply it to: migration 0008 creates NO new
-- functions, so there is no new `public` function for Supabase's ALTER DEFAULT PRIVILEGES to hand
-- anon/authenticated over PostgREST `/rpc`, and no new `search_path` to pin. The wallet arithmetic
-- lives in TypeScript (`lib/cookies/repo.ts`) precisely so nothing here needs hardening.

do $$
declare
  t text;
begin
  foreach t in array array['prompt_unlocks', 'cookie_ledger', 'cookie_purchase_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
