-- PLAYBOOK · core migration 0010
-- Founder direction (2026-08-15): "유저가 프롬프트 제출할 때는 좀 더 간소하게 — 자기가 SNS에
-- 올린 영상 링크를 첨부한다던지."
--
-- The submission form asked a creator to re-export and upload media they had ALREADY posted. The
-- cheapest thing a creator can give is the link to their own post, so `source_url` becomes the easy
-- path: paste where it lives, done. Uploads stay available for anyone who wants the clip hosted
-- here (the card's hover video needs a file), but nothing is required any more.
--
-- Same shape as `contest_entries.video_url` (§14.1), for the same reason: we LINK to films, we do
-- not host them. The CHECK is the same http(s) rule — the column is rendered as an anchor, so
-- anything that is not a web URL has no business being in it (`javascript:` above all).
alter table prompt_items add column if not exists source_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'prompt_items_source_url_http') then
    alter table prompt_items
      add constraint prompt_items_source_url_http
      check (source_url is null or source_url ~ '^https?://');
  end if;
end
$$;
