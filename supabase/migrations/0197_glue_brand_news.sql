-- 클라우드 적용 필요 — TWINGS · glue migration 0197 — pairs with 0196 (the home's news slot)
-- No browser key reads or writes either table: the brand home reads announcements on the app's server role
-- (lib/brand-news/service.ts), a member closes one through POST /api/brand-workspace (`news.dismiss`, server role),
-- and only /admin/do writes announcements (`brandNews.*`). Deny-all RLS, no policy, browser roles revoked.
-- The server role gets only what the code does (the 0113 shape): both tables are read and inserted; an announcement
-- is updated column by column (its id, slot, author and creation time never change) and never deleted; a dismissal is
-- never changed or deleted by the app (it goes with its announcement or its profile, by the foreign keys' cascade).
do $$ declare t text; begin
 foreach t in array array['brand_announcements','brand_announcement_dismissals'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert on public.%I to service_role',t);
 end loop;
end $$;

grant update(kicker_ko,kicker_en,title_ko,title_en,cta_label_ko,cta_label_en,cta_href,shape,image_key,image_w,image_h,starts_at,ends_at,audience,status,updated_at,published_at,ended_at)
  on public.brand_announcements to service_role;
