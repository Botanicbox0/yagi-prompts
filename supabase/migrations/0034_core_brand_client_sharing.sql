-- 클라우드 적용 필요 (then 0120_glue_brand_client_sharing.sql). Private client sharing of a studio campaign.
-- Narrow additions. None of them creates an approval, an upload, creator consent, a publish time
-- or a metric that did not really happen.

-- 1. Already-published external posts. A link the studio appends is recorded as exactly that:
--    `external_import`, with no content version (it never went through this workspace's review) and a
--    publish time that stays NULL until it is actually known. Normal posts keep every original rule:
--    an internally approved content version and a publish time are still required by the database.
alter table brand_posts add column origin text not null default 'approved_content'
  check(origin in ('approved_content','external_import'));
alter table brand_posts alter column content_version_id drop not null;
alter table brand_posts alter column published_at drop not null;
alter table brand_posts add constraint brand_posts_origin_shape check(
  (origin='approved_content' and content_version_id is not null and published_at is not null)
  or (origin='external_import' and content_version_id is null));

-- A known publish time never changes. An unknown one on an imported link may be filled in once.
create function brand_post_published_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.origin is distinct from old.origin or new.content_version_id is distinct from old.content_version_id then
    raise exception 'brand post origin is immutable' using errcode='23514';
  end if;
  if new.published_at is distinct from old.published_at and (old.published_at is not null or old.origin<>'external_import') then
    raise exception 'a known publish time is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_post_published_guard before update on brand_posts for each row execute function brand_post_published_guard();

-- Publicly rounded view counts. Some platform surfaces show only an abbreviated count ("12.3K").
-- That observation is kept, but flagged, on the immutable history row and on the latest projection
-- alike, so no total built from it can read as exact. Existing rows are exact observations: false.
alter table brand_post_measurements add column views_approximate boolean not null default false;
alter table brand_post_measurements add constraint brand_post_measurements_views_approximate
  check(not views_approximate or views is not null);
alter table brand_posts add column views_approximate boolean not null default false;
alter table brand_posts add constraint brand_posts_views_approximate
  check(not views_approximate or views is not null);

-- 2. Campaign cover: a private image attachment owned by the same project, never a content version.
--    The composite key makes another project's attachment unreachable; the guard keeps it an image.
alter table brand_projects add column cover_attachment_id uuid;
alter table brand_projects add constraint brand_projects_cover_same_project
  foreign key(id,cover_attachment_id) references brand_attachments(project_id,id);
create function brand_project_cover_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.cover_attachment_id is null then return new; end if;
  if tg_op='UPDATE' then
    if new.cover_attachment_id is not distinct from old.cover_attachment_id then return new; end if;
  end if;
  if not exists(select 1 from brand_attachments a where a.project_id=new.id and a.id=new.cover_attachment_id
      and a.status='ready' and a.access_scope='workspace' and a.mime in ('image/jpeg','image/png','image/webp')) then
    raise exception 'campaign cover must be a ready image of the same project' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_project_cover_guard before insert or update on brand_projects for each row execute function brand_project_cover_guard();

-- 3. Comments for campaign-only guests. Explicit and per invitation: existing campaign-only guests were
--    invited read-only and stay read-only. Commenting never grants approval, uploads, contracts,
--    organization settings or team management.
alter table brand_invites add column can_comment boolean not null default false;
alter table brand_invites add constraint brand_invites_comment_scope check(not can_comment or project_id is not null);
alter table brand_project_members add column can_comment boolean not null default false;

revoke all on function brand_post_published_guard() from public;
revoke all on function brand_project_cover_guard() from public;
