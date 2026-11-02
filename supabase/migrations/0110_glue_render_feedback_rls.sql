-- PLAYBOOK · glue migration 0110 — render_feedback RLS (mirrors 0107 for render_jobs).
--
-- Deny-all with no policies: the owner writes through a server action that checks ownership, and
-- the studio reads on the admin inbox. The browser never touches the table.
do $$
declare
  t text;
begin
  foreach t in array array['render_feedback'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
