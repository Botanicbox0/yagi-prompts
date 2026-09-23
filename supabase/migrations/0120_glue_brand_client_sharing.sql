-- 클라우드 적용 필요 (after 0034_core_brand_client_sharing.sql). Browser roles still receive no table access.
-- The server role gets exactly these new column updates; the guards in 0034 bound what they may do.
-- brand_post_measurements stays insert-only: its new views_approximate column is never updatable.
grant update(cover_attachment_id) on brand_projects to service_role;
grant update(published_at,views_approximate) on brand_posts to service_role;
grant update(can_comment) on brand_project_members to service_role;
revoke all on function brand_post_published_guard() from public,anon,authenticated,service_role;
revoke all on function brand_project_cover_guard() from public,anon,authenticated,service_role;
