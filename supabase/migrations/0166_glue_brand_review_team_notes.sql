-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0166 — pairs with 0093 (brand_studio_review_comments.visibility)
-- No new table and no new policy. The column inherits the posture the table got in 0155 (RLS on + forced,
-- no browser policies, service_role only), so no browser key can read a team note even by asking for it.
-- Strictly nothing here is needed; it re-asserts that posture the way 0164 does for 0090, so the pair is
-- safe to apply on its own.
do $$ begin
  execute 'alter table public.brand_studio_review_comments enable row level security';
  execute 'alter table public.brand_studio_review_comments force row level security';
  execute 'revoke all on public.brand_studio_review_comments from public,anon,authenticated';
  execute 'grant select,insert,update,delete on public.brand_studio_review_comments to service_role';
end $$;
