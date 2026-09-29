-- 클라우드 적용 필요 (0039 다음). No glue migration: identity_groups keeps its RLS and grants
-- (0108_glue_identity_rls; the new column inherits them).
--
-- Slot rotation (docs/TEMPLATES-IA.md §12, 2026-09-19; reconfirmed by the founder 2026-09-28).
-- The free Entry tier holds 50 groups / 50 assets at the bank. When a new person or photo would
-- cross the rotation limit, the least recently used AIGC person is deleted AT THE BANK and their
-- row here says so:
--
--   identity_groups.status = 'evicted'
--       The bank no longer has this group. The next render makes a new AIGC group and registers
--       the photo again from our own store (about five seconds). LivenessFace groups are never
--       evicted: deleting one would mean the person passes the camera check again.
--   identity_groups.evicted_at
--       When that happened (kept after the person comes back, as the last eviction).

alter table identity_groups drop constraint if exists identity_groups_status_check;
alter table identity_groups add constraint identity_groups_status_check
  check (status in ('pending', 'active', 'failed', 'revoked', 'evicted'));

alter table identity_groups add column if not exists evicted_at timestamptz;
