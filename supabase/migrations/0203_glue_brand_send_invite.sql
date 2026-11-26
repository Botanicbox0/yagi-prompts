-- 클라우드 적용 필요 — TWINGS · glue migration 0203 — pairs with 0202 (초대하고 보내기: lines waiting for an invitation)
-- No browser key reads or writes this table: 보내기 and the invitation's acceptance run on the app's server role
-- (POST /api/brand-rooms/messages `send.post`/`send.reply`; POST /api/brand-workspace `invitation.accept`), as the rest of
-- the room conversation does (0156, 0167, 0201). Deny-all RLS, no policy, browser roles revoked.
--
-- brand_room_pending_mentions (new): the server role gets only what the code does: write a row when a line is sent,
-- read the rows (a line's invitation chips, an acceptance), delete them when the invitation is accepted. Nothing updates
-- a row. The guard function runs only as the table's trigger: nobody may call it.
do $$ declare t text; begin
 foreach t in array array['brand_room_pending_mentions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert,delete on public.%I to service_role',t);
 end loop;
end $$;

revoke all on function public.brand_room_pending_mentions_guard() from public, anon, authenticated, service_role;
