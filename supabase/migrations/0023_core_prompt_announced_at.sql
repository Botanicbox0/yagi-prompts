-- PLAYBOOK · core migration 0023 — the weekly drop's one-shot alert (founder, 2026-09-13: "주간 드롭은
-- 내가 수동으로", the studio presses one button and every "새 템플릿 알림" subscriber gets one mail).
--
-- `announced_at` is the guard: the admin operation refuses a second send for the same template, so
-- a double click, a retried request or a second operator cannot mail the whole list twice.
alter table prompt_items add column if not exists announced_at timestamptz;
