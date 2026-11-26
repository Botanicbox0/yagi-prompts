-- 클라우드 적용 필요 — TWINGS · glue migration 0205 — pairs with 0204 (brand home news follow-ups: delete draft privilege)
-- No browser key reads, writes, or deletes either table: only /admin/do (`brandNews.delete`, server role) deletes
-- draft announcements (`status = 'draft'`). Deny-all RLS, no policy, browser roles revoked.
--
-- Preserves all grants from 0197 (`select,insert` on both tables and column-level `update` on `brand_announcements`,
-- keeping `id`, `slot`, `created_by`, `created_at` non-updatable) and grants ONLY `delete` on `public.brand_announcements`
-- to `service_role`. `brand_announcement_dismissals` remains non-deletable (cascade-only).
do $$ declare t text; begin
 foreach t in array array['brand_announcements','brand_announcement_dismissals'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

grant delete on public.brand_announcements to service_role;
revoke all on function public.brand_announcements_draft_delete_only() from public, anon, authenticated, service_role;
