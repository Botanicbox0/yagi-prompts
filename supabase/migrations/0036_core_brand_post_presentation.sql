-- 클라우드 적용 필요 (then 0122_glue_brand_post_presentation.sql). How a post is recognized on the client's
-- campaign page: a private thumbnail the studio uploaded, the creator's account handle and, when it is
-- actually known, a follower count with its source and time. Presentation only: no metric, measurement
-- history, approval or publish time changes through these columns, and nothing is fetched from a link.

-- 1. Thumbnail: one of the SAME project's own ready images. The composite key makes another project's
--    attachment unreachable and there is no remote URL column. NULL means no thumbnail yet.
alter table brand_posts add column thumbnail_attachment_id uuid;
alter table brand_posts add constraint brand_posts_thumbnail_same_project
  foreign key(project_id,thumbnail_attachment_id) references brand_attachments(project_id,id);

-- 2. Creator identity as the studio read it. The handle is stored without '@'. NULL is unknown.
--    The exact character set is validated by the service (YouTube handles may be non-Latin); the
--    database refuses anything that could read as a link, path or second line whatever the locale.
alter table brand_posts add column creator_handle text
  check(char_length(creator_handle) between 1 and 50 and creator_handle !~ '[[:cntrl:][:space:]@/\\:?#<>"'']');
alter table brand_posts add column creator_name text
  check(creator_name is null or (char_length(creator_name) between 1 and 80 and creator_name = btrim(creator_name)));

-- 3. Follower count: unknown stays NULL (never 0). A known count always carries where it was read and
--    when; a publicly rounded display ("12.3만") is kept but flagged approximate.
alter table brand_posts add column follower_count bigint check(follower_count between 0 and 10000000000);
alter table brand_posts add column followers_approximate boolean not null default false;
alter table brand_posts add column followers_source text check(followers_source in ('creator_evidence','studio_review'));
alter table brand_posts add column followers_measured_at timestamptz;
alter table brand_posts add constraint brand_posts_followers_shape check(
  (follower_count is null and not followers_approximate and followers_source is null and followers_measured_at is null)
  or (follower_count is not null and followers_source is not null and followers_measured_at is not null));

-- 4. Optimistic-concurrency token for presentation edits, independent of metric_revision.
alter table brand_posts add column presentation_revision integer not null default 0 check(presentation_revision >= 0);

-- Every presentation change moves the revision by exactly one; the thumbnail stays a ready image of
-- this project (mirrors the campaign-cover guard in 0034).
create function brand_post_presentation_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if (new.thumbnail_attachment_id, new.creator_handle, new.creator_name, new.follower_count, new.followers_approximate,
      new.followers_source, new.followers_measured_at)
    is distinct from (old.thumbnail_attachment_id, old.creator_handle, old.creator_name, old.follower_count, old.followers_approximate,
      old.followers_source, old.followers_measured_at) then
    if new.presentation_revision <> old.presentation_revision + 1 then
      raise exception 'post presentation revision must advance by one' using errcode='23514';
    end if;
  elsif new.presentation_revision <> old.presentation_revision then
    raise exception 'post presentation revision moved without a change' using errcode='23514';
  end if;
  if new.thumbnail_attachment_id is not null and new.thumbnail_attachment_id is distinct from old.thumbnail_attachment_id
    and not exists(select 1 from brand_attachments a where a.project_id=new.project_id and a.id=new.thumbnail_attachment_id
      and a.status='ready' and a.access_scope='workspace' and a.mime in ('image/jpeg','image/png','image/webp')) then
    raise exception 'post thumbnail must be a ready image of the same project' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_post_presentation_guard before update on brand_posts for each row execute function brand_post_presentation_guard();
