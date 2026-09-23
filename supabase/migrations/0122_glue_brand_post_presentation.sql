-- 클라우드 적용 필요 (after 0036_core_brand_post_presentation.sql). Browser roles still receive no table access.
-- The server role gets exactly the presentation columns; metric columns and measurement history keep
-- their existing grants, and brand_post_measurements stays insert-only.
revoke all on public.brand_posts from anon,authenticated;
grant update(thumbnail_attachment_id,creator_handle,creator_name,follower_count,followers_approximate,followers_source,followers_measured_at,presentation_revision)
  on brand_posts to service_role;
revoke all on function brand_post_presentation_guard() from public,anon,authenticated,service_role;
