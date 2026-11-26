-- 클라우드 적용 필요 — TWINGS · glue migration 0199 — pairs with 0198 (보내기: members channel, per-thread reads)
-- No browser key reads or writes any of these tables: 보내기 runs on the app's server role (POST /api/brand-rooms/messages,
-- `send.*`; lib/brand-rooms/send.ts), as the rest of the room conversation does (0156, 0167). Deny-all RLS, no policy,
-- browser roles revoked.
--
-- brand_room_thread_reads (new): the server role gets only what the code does: read a mark, write one, move one forward
-- (insert … on conflict do update). Nothing deletes a mark; it goes with its thread, person or organization by the
-- foreign keys' cascade.
do $$ declare t text; begin
 foreach t in array array['brand_room_thread_reads'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
 end loop;
end $$;

-- The three tables 0198 changed (checks and one new column) keep exactly their posture (0156 and 0167): re-asserted for
-- browser roles only, the server role's grants untouched, so this pair is safe to apply on its own.
do $$ declare t text; begin
 foreach t in array array['brand_room_messages','brand_room_reads','brand_room_notices'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;
