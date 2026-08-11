-- PLAYBOOK · M0 · core migration 0003
-- Immutability + privileged-channel enforcement (PLAN §6, R3b).
--
-- Two distinct rules, both enforced by CONSTRAINT TRIGGERs:
--   A. INSERT/UPDATE/DELETE on steps / blocks / publish_assets are rejected whenever the
--      owning revision's state <> 'draft'. Unconditional — the publish RPCs do all of their
--      content writes while the revision is still draft, and transition last.
--   B. `state` transitions, `resolved_visibility` stamping and `playbooks.published_revision_id`
--      swaps require current_user = 'publisher' — true only inside the SECURITY DEFINER RPCs.
--      Allowed transitions: draft→published, published→superseded. Nothing else.

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_playbooks_updated_at on playbooks;
create trigger trg_playbooks_updated_at before update on playbooks
  for each row execute function set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on subscriptions;
create trigger trg_subscriptions_updated_at before update on subscriptions
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- playbook_revisions
-- ---------------------------------------------------------------------------
create or replace function guard_playbook_revisions()
returns trigger
language plpgsql
as $$
declare
  v_content_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'revisions are born draft (attempted state=%)', new.state
        using errcode = 'check_violation';
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    if old.state <> 'draft' then
      raise exception 'revision % is % and cannot be deleted; published content is immutable',
        old.id, old.state
        using errcode = 'check_violation';
    end if;
    return null;
  end if;

  -- UPDATE ---------------------------------------------------------------
  if new.state is distinct from old.state then
    if current_user <> 'publisher' then
      raise exception 'revision state transitions are reserved to the publish RPCs (current_user=%)',
        current_user
        using errcode = 'insufficient_privilege';
    end if;
    if not ((old.state = 'draft'     and new.state = 'published')
         or (old.state = 'published' and new.state = 'superseded')) then
      raise exception 'illegal revision state transition % -> %', old.state, new.state
        using errcode = 'check_violation';
    end if;
  end if;

  if new.published_at is distinct from old.published_at and current_user <> 'publisher' then
    raise exception 'published_at is stamped by publish_revision only (current_user=%)', current_user
      using errcode = 'insufficient_privilege';
  end if;

  v_content_changed :=
       new.playbook_id  is distinct from old.playbook_id
    or new.rev_no       is distinct from old.rev_no
    or new.is_showcase  is distinct from old.is_showcase
    or new.title        is distinct from old.title
    or new.summary      is distinct from old.summary
    or new.difficulty   is distinct from old.difficulty
    or new.tools        is distinct from old.tools
    or new.models       is distinct from old.models
    or new.est_time_min is distinct from old.est_time_min
    or new.est_cost_usd is distinct from old.est_cost_usd
    or new.hero_asset   is distinct from old.hero_asset
    or new.change_note  is distinct from old.change_note
    or new.created_at   is distinct from old.created_at;

  if old.state <> 'draft' and v_content_changed then
    raise exception 'revision % is % and immutable', old.id, old.state
      using errcode = 'check_violation';
  end if;

  return null;
end
$$;

drop trigger if exists trg_guard_playbook_revisions on playbook_revisions;
create constraint trigger trg_guard_playbook_revisions
  after insert or update or delete on playbook_revisions
  for each row execute function guard_playbook_revisions();

-- ---------------------------------------------------------------------------
-- steps
-- ---------------------------------------------------------------------------
create or replace function guard_steps()
returns trigger
language plpgsql
as $$
declare
  v_revision_id uuid;
  v_state text;
begin
  if tg_op = 'DELETE' then
    v_revision_id := old.revision_id;
  else
    v_revision_id := new.revision_id;
  end if;

  select r.state into v_state from playbook_revisions r where r.id = v_revision_id;
  if v_state is null then
    -- owning revision already gone (cascade) — nothing left to protect
    return null;
  end if;

  if v_state <> 'draft' then
    raise exception '% on a step of a % revision: published content is immutable', tg_op, v_state
      using errcode = 'check_violation';
  end if;

  return null;
end
$$;

drop trigger if exists trg_guard_steps on steps;
create constraint trigger trg_guard_steps
  after insert or update or delete on steps
  for each row execute function guard_steps();

-- ---------------------------------------------------------------------------
-- blocks
-- ---------------------------------------------------------------------------
create or replace function guard_blocks()
returns trigger
language plpgsql
as $$
declare
  v_step_id uuid;
  v_state text;
begin
  if tg_op = 'DELETE' then
    v_step_id := old.step_id;
  else
    v_step_id := new.step_id;
  end if;

  select r.state into v_state
    from steps s
    join playbook_revisions r on r.id = s.revision_id
   where s.id = v_step_id;

  if v_state is null then
    -- owning step/revision already gone (cascade) — nothing left to protect
    return null;
  end if;

  if v_state <> 'draft' then
    raise exception '% on a block of a % revision: published content is immutable', tg_op, v_state
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT'
     and new.resolved_visibility is not null
     and current_user <> 'publisher' then
    raise exception 'resolved_visibility is stamped by prepare_publish only (current_user=%)',
      current_user
      using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE'
     and new.resolved_visibility is distinct from old.resolved_visibility
     and current_user <> 'publisher' then
    raise exception 'resolved_visibility is stamped by prepare_publish only (current_user=%)',
      current_user
      using errcode = 'insufficient_privilege';
  end if;

  return null;
end
$$;

drop trigger if exists trg_guard_blocks on blocks;
create constraint trigger trg_guard_blocks
  after insert or update or delete on blocks
  for each row execute function guard_blocks();

-- ---------------------------------------------------------------------------
-- publish_assets — the manifest of a published revision is immutable too
-- ---------------------------------------------------------------------------
create or replace function guard_publish_assets()
returns trigger
language plpgsql
as $$
declare
  v_revision_id uuid;
  v_state text;
begin
  if tg_op = 'DELETE' then
    v_revision_id := old.revision_id;
  else
    v_revision_id := new.revision_id;
  end if;

  select r.state into v_state from playbook_revisions r where r.id = v_revision_id;
  if v_state is null then
    return null;
  end if;

  if v_state <> 'draft' then
    raise exception '% on the publish manifest of a % revision is not allowed', tg_op, v_state
      using errcode = 'check_violation';
  end if;

  return null;
end
$$;

drop trigger if exists trg_guard_publish_assets on publish_assets;
create constraint trigger trg_guard_publish_assets
  after insert or update or delete on publish_assets
  for each row execute function guard_publish_assets();

-- ---------------------------------------------------------------------------
-- playbooks — the published pointer is swapped by publish_revision only
-- ---------------------------------------------------------------------------
create or replace function guard_playbooks()
returns trigger
language plpgsql
as $$
begin
  if new.published_revision_id is distinct from old.published_revision_id
     and current_user <> 'publisher' then
    raise exception 'published_revision_id is swapped by publish_revision only (current_user=%)',
      current_user
      using errcode = 'insufficient_privilege';
  end if;
  return null;
end
$$;

drop trigger if exists trg_guard_playbooks on playbooks;
create constraint trigger trg_guard_playbooks
  after update on playbooks
  for each row execute function guard_playbooks();
