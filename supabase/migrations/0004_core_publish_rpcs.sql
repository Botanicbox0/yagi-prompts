-- PLAYBOOK · M0 · core migration 0004
-- Two-phase publication (PLAN §6, R3b/R3c):
--   Phase A  prepare_publish(revision)          — stamp resolved_visibility, rewrite manifest
--   Phase B  copier                             — server code, lib/storage (sets copied_at)
--   Phase C  publish_revision(pb, rev, notify)  — validate, stamp keys, transition, enqueue
--
-- R3c execution note: manifest-currentness compares the COMPLETE canonical asset set —
-- refs, hashes, source keys AND routing — not a subset. `canonical_manifest()` below is the
-- single definition of that set and is used by BOTH phases, so they can never disagree.

-- ---------------------------------------------------------------------------
-- canonical_manifest — the derived truth about which bytes ship where.
-- Routing (PLAN §6 Phase A.3):
--   hero                         → public-content   (heroes are public marketing surface, §3.1)
--   workflow_file               → artifacts-published (private)
--   resolved 'public' + showcase → public-content
--   everything else              → content-published (private)
-- ---------------------------------------------------------------------------
create or replace function canonical_manifest(p_revision_id uuid)
returns table (
  ref text,
  sha256 text,
  source_staging_key text,
  target_bucket text,
  target_key text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with rev as (
    select * from playbook_revisions where id = p_revision_id
  ),
  raw as (
    select
      'hero'::text                        as ref,
      r.hero_asset ->> 'sha256'           as sha256,
      r.hero_asset ->> 'staging_key'      as source_staging_key,
      'public-content'::text              as target_bucket
    from rev r
    where r.hero_asset is not null
      and jsonb_typeof(r.hero_asset) = 'object'
    union all
    select
      b.id::text,
      b.content -> 'asset' ->> 'sha256',
      b.content -> 'asset' ->> 'staging_key',
      case
        when b.kind = 'workflow_file' then 'artifacts-published'
        when b.resolved_visibility = 'public'::visibility and r.is_showcase then 'public-content'
        else 'content-published'
      end
    from blocks b
    join steps s on s.id = b.step_id
    join rev r   on r.id = s.revision_id
    where b.content ? 'asset'
      and jsonb_typeof(b.content -> 'asset') = 'object'
  )
  select
    m.ref,
    m.sha256,
    m.source_staging_key,
    m.target_bucket,
    m.sha256 || asset_ext(m.source_staging_key)
  from raw m;
$$;

-- ---------------------------------------------------------------------------
-- Phase A — prepare_publish
-- ---------------------------------------------------------------------------
create or replace function prepare_publish(p_revision_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rev playbook_revisions%rowtype;
begin
  select * into v_rev from playbook_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'revision % not found', p_revision_id using errcode = 'no_data_found';
  end if;
  if v_rev.state <> 'draft' then
    raise exception 'prepare_publish requires a draft revision (state=%)', v_rev.state
      using errcode = 'check_violation';
  end if;

  -- A.2 stamp effective visibility: coalesce(override, default_policy[kind])
  update blocks b
     set resolved_visibility = coalesce(
           b.visibility,
           (select dp.visibility from default_policy dp where dp.kind = b.kind)
         )
    from steps s
   where b.step_id = s.id
     and s.revision_id = p_revision_id;

  if exists (
    select 1
      from blocks b
      join steps s on s.id = b.step_id
     where s.revision_id = p_revision_id
       and b.resolved_visibility is null
  ) then
    raise exception 'default_policy has no row for one or more block kinds in revision %', p_revision_id
      using errcode = 'check_violation';
  end if;

  -- A.3 rewrite the manifest from already-stamped values
  if exists (
    select 1 from canonical_manifest(p_revision_id) c
     where c.sha256 is null or btrim(c.sha256) = ''
        or c.source_staging_key is null or btrim(c.source_staging_key) = ''
  ) then
    raise exception 'every AssetRef must carry sha256 + staging_key before prepare_publish'
      using errcode = 'check_violation';
  end if;

  insert into publish_assets (revision_id, ref, sha256, source_staging_key, target_bucket, target_key)
  select p_revision_id, c.ref, c.sha256, c.source_staging_key, c.target_bucket, c.target_key
    from canonical_manifest(p_revision_id) c
  on conflict (revision_id, ref) do update
    set sha256             = excluded.sha256,
        source_staging_key = excluded.source_staging_key,
        target_bucket      = excluded.target_bucket,
        target_key         = excluded.target_key,
        -- copied bytes stay valid only when every canonical field is unchanged
        copied_at = case
          when publish_assets.sha256             = excluded.sha256
           and publish_assets.source_staging_key = excluded.source_staging_key
           and publish_assets.target_bucket      = excluded.target_bucket
           and publish_assets.target_key         = excluded.target_key
          then publish_assets.copied_at
          else null
        end;

  delete from publish_assets pa
   where pa.revision_id = p_revision_id
     and not exists (select 1 from canonical_manifest(p_revision_id) c where c.ref = pa.ref);
end
$$;

-- ---------------------------------------------------------------------------
-- Phase C — publish_revision
-- ---------------------------------------------------------------------------
create or replace function publish_revision(
  p_playbook_id uuid,
  p_revision_id uuid,
  p_notify_kind text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pb   playbooks%rowtype;
  v_rev  playbook_revisions%rowtype;
  v_prev uuid;
  v_bad  int;
begin
  select * into v_pb from playbooks where id = p_playbook_id for update;
  if not found then
    raise exception 'playbook % not found', p_playbook_id using errcode = 'no_data_found';
  end if;

  select * into v_rev from playbook_revisions where id = p_revision_id for update;
  if not found then
    raise exception 'revision % not found', p_revision_id using errcode = 'no_data_found';
  end if;

  -- C.1 composite ownership (the structural FK guards the pointer; this guards the call)
  if v_rev.playbook_id <> p_playbook_id then
    raise exception 'revision % belongs to playbook %, not %',
      p_revision_id, v_rev.playbook_id, p_playbook_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_rev.state <> 'draft' then
    raise exception 'publish_revision requires a draft revision (state=%)', v_rev.state
      using errcode = 'check_violation';
  end if;

  -- C.1 locale completeness (PLAN §3.9 publish gate)
  if not is_localized_complete(v_rev.title) then
    raise exception 'revision title requires both en and ko' using errcode = 'check_violation';
  end if;
  if not is_localized_complete(v_rev.summary) then
    raise exception 'revision summary requires both en and ko' using errcode = 'check_violation';
  end if;

  select count(*) into v_bad
    from steps s
   where s.revision_id = p_revision_id and not is_localized_complete(s.title);
  if v_bad > 0 then
    raise exception '% step title(s) missing a locale', v_bad using errcode = 'check_violation';
  end if;

  select count(*) into v_bad
    from steps s
   where s.revision_id = p_revision_id
     and s.body is not null and jsonb_typeof(s.body) = 'object'
     and not is_localized_complete(s.body);
  if v_bad > 0 then
    raise exception '% step body/bodies missing a locale', v_bad using errcode = 'check_violation';
  end if;

  select count(*) into v_bad
    from blocks b join steps s on s.id = b.step_id
   where s.revision_id = p_revision_id
     and b.kind = 'asset' and b.content ? 'caption'
     and not is_localized_complete(b.content -> 'caption');
  if v_bad > 0 then
    raise exception '% asset caption(s) missing a locale', v_bad using errcode = 'check_violation';
  end if;

  select count(*) into v_bad
    from blocks b join steps s on s.id = b.step_id
   where s.revision_id = p_revision_id
     and b.kind = 'link' and not is_localized_complete(b.content -> 'label');
  if v_bad > 0 then
    raise exception '% link label(s) missing a locale', v_bad using errcode = 'check_violation';
  end if;

  select count(*) into v_bad
    from blocks b join steps s on s.id = b.step_id
   where s.revision_id = p_revision_id
     and b.kind = 'note' and not is_localized_complete(b.content -> 'md');
  if v_bad > 0 then
    raise exception '% note block(s) missing a locale', v_bad using errcode = 'check_violation';
  end if;

  -- C.1 change note required when the playbook was previously published
  if v_pb.published_revision_id is not null and not is_localized_complete(v_rev.change_note) then
    raise exception 'republishing "%" requires a bilingual change_note', v_pb.slug
      using errcode = 'check_violation';
  end if;

  -- C.1 prepared?
  if exists (
    select 1 from blocks b join steps s on s.id = b.step_id
     where s.revision_id = p_revision_id and b.resolved_visibility is null
  ) then
    raise exception 'revision % is not prepared (unstamped resolved_visibility); run prepare_publish',
      p_revision_id
      using errcode = 'check_violation';
  end if;

  -- C.1 manifest complete — every referenced object physically copied
  select count(*) into v_bad
    from publish_assets pa
   where pa.revision_id = p_revision_id and pa.copied_at is null;
  if v_bad > 0 then
    raise exception 'publish manifest incomplete: % asset(s) not copied yet', v_bad
      using errcode = 'check_violation';
  end if;

  -- C.1 manifest current — complete canonical set, both directions (R3c)
  select count(*) into v_bad from (
    (
      select c.ref, c.sha256, c.source_staging_key, c.target_bucket, c.target_key
        from canonical_manifest(p_revision_id) c
      except
      select pa.ref, pa.sha256, pa.source_staging_key, pa.target_bucket, pa.target_key
        from publish_assets pa where pa.revision_id = p_revision_id
    )
    union all
    (
      select pa.ref, pa.sha256, pa.source_staging_key, pa.target_bucket, pa.target_key
        from publish_assets pa where pa.revision_id = p_revision_id
      except
      select c.ref, c.sha256, c.source_staging_key, c.target_bucket, c.target_key
        from canonical_manifest(p_revision_id) c
    )
  ) diff;
  if v_bad > 0 then
    raise exception 'publish manifest is stale for revision % (% divergent row(s)); re-run prepare_publish',
      p_revision_id, v_bad
      using errcode = 'check_violation';
  end if;

  -- C.2 stamp published_key / bucket into every AssetRef (revision is still draft here)
  update playbook_revisions r
     set hero_asset = r.hero_asset
       || jsonb_build_object('published_key', pa.target_key, 'bucket', pa.target_bucket)
    from publish_assets pa
   where r.id = p_revision_id
     and pa.revision_id = p_revision_id
     and pa.ref = 'hero';

  update blocks b
     set content = jsonb_set(
           b.content,
           '{asset}',
           (b.content -> 'asset')
             || jsonb_build_object('published_key', pa.target_key, 'bucket', pa.target_bucket)
         )
    from steps s, publish_assets pa
   where b.step_id = s.id
     and s.revision_id = p_revision_id
     and pa.revision_id = p_revision_id
     and pa.ref = b.id::text;

  -- C.3 transitions
  v_prev := v_pb.published_revision_id;
  if v_prev is not null and v_prev <> p_revision_id then
    update playbook_revisions set state = 'superseded'
     where id = v_prev and state = 'published';
  end if;

  update playbook_revisions
     set state = 'published', published_at = now()
   where id = p_revision_id;

  update playbooks
     set published_revision_id = p_revision_id,
         status = 'published'
   where id = p_playbook_id;

  -- C.4 notification job (M5+; the server forces NULL before that)
  if p_notify_kind is not null then
    if p_notify_kind not in ('new_playbook','playbook_update') then
      raise exception 'unknown notification kind %', p_notify_kind using errcode = 'check_violation';
    end if;
    insert into notification_jobs (revision_id, kind)
    values (p_revision_id, p_notify_kind)
    on conflict (revision_id, kind) do nothing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- The privileged channel: both RPCs run as `publisher`; nothing else does.
-- ---------------------------------------------------------------------------
-- Supabase note (cloud apply, 2026-08-13): the new owner must already hold CREATE on the schema
-- when ownership transfers — so the schema grant comes FIRST. Harmless on PGlite (superuser applier).
grant usage, create on schema public to publisher;

alter function canonical_manifest(uuid) owner to publisher;
alter function prepare_publish(uuid) owner to publisher;
alter function publish_revision(uuid, uuid, text) owner to publisher;
grant select, insert, update, delete on
  playbooks, playbook_revisions, steps, blocks, publish_assets, notification_jobs
  to publisher;
grant select on default_policy to publisher;
