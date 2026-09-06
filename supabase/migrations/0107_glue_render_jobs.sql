-- PLAYBOOK · glue migration 0107 — render jobs RLS + the private `renders` bucket
-- (NOT applied by the PGlite test harness; mirrors 0106 for the table and 0101 for the bucket).
--
-- Deny-all with no policies: the browser never reads a job directly — the owner's page and the
-- 3-day share page both go through the server, and every byte is served by the render gateway
-- (`/api/renders/media/[id]`) after it has checked the session or the share token.
do $$
declare
  t text;
begin
  foreach t in array array['render_jobs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- The visitor's photo and the finished render. PRIVATE: a share link is a signed URL the gateway
-- mints for a few minutes, never the object's own address. Storage RLS stays deny-all (0101).
insert into storage.buckets (id, name, public)
values ('renders', 'renders', false)
on conflict (id) do update set public = excluded.public;
