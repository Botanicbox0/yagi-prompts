-- PLAYBOOK · core migration 0022 — feedback on a result (founder, 2026-09-11: "콘텐츠가 잘 안 나왔어요
-- 같은 불만을 우리한테 넘길 수 있는 시스템").
--
-- One row per render, written by its owner from the result page: what went wrong in their words
-- (a reason from a short list, plus a message), and the studio's bookkeeping on the reply. A second
-- submission on the same render replaces the first and reopens it — a person who writes twice is
-- still one conversation. The refund policy §4 (재생성 1회 또는 환불) is decided from here.
create table if not exists render_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  render_id uuid not null unique references render_jobs on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  reason text not null check (reason in ('face', 'playback', 'mismatch', 'other')),
  message text check (message is null or char_length(message) <= 2000),
  status text not null default 'new' check (status in ('new', 'replied', 'closed')),
  replied_at timestamptz
);

create index if not exists render_feedback_status_idx on render_feedback (status, created_at desc);
create index if not exists render_feedback_user_idx on render_feedback (user_id, created_at desc);
