-- 클라우드 적용 필요 — TWINGS · glue migration 0191 — template style preference posture (pairs with 0190)
-- 0190 adds columns to two tables that are already closed to every browser key (profiles: 0100, prompt_items: 0102).
-- Nothing new is opened: the style choice is written only by the server route (app/api/account/template-look) and the
-- template's style only by the admin form, both on the app's server role. The 0100/0102 posture is re-asserted for
-- both tables, nothing more (no grant, no rule for a browser role).
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'prompt_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
