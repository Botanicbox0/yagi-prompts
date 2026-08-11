-- PLAYBOOK · M0 · core migration 0002
-- Domain model, verbatim from PLAN §6.
--
-- NOTE (PGlite acceptance): `profiles.id` references `auth.users`, a Supabase-managed table.
-- The vitest PGlite harness creates a minimal `auth.users(id uuid primary key)` stub BEFORE
-- applying migrations (see supabase/README.md). Nothing here creates it.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  email text not null,
  display_name text,
  locale text not null default 'en' check (locale in ('en','ko')),
  plan text not null default 'free' check (plan in ('free','pro')),  -- display mirror; truth = subscriptions
  is_admin boolean not null default false,
  stripe_customer_id text unique,
  notif_new_playbook boolean not null default false,
  notif_updates boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- visibility enum — declaration order IS the ordering: public < free < pro < hidden
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'visibility') then
    create type visibility as enum ('public','free','pro','hidden');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- playbooks / revisions
-- ---------------------------------------------------------------------------
create table if not exists playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  category text not null check (category in ('image','video','character','voice','music','pipeline')),
  sort int not null default 0,
  published_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists playbook_revisions (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks on delete cascade,
  rev_no int not null,
  state text not null default 'draft' check (state in ('draft','published','superseded')),
  is_showcase boolean not null default false,  -- revisioned: SEO eligibility + asset routing take effect on publish
  title jsonb not null,
  summary jsonb not null,
  difficulty text not null default 'intermediate' check (difficulty in ('beginner','intermediate','advanced')),
  tools text[] not null default '{}',
  models text[] not null default '{}',
  est_time_min int check (est_time_min is null or est_time_min > 0),
  est_cost_usd numeric(8,2) check (est_cost_usd is null or est_cost_usd >= 0),
  hero_asset jsonb,              -- AssetRef (§6.1); heroes are always public-published
  change_note jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (playbook_id, rev_no),
  unique (playbook_id, id)       -- enables the same-playbook composite FK below
);

-- Same-playbook pointer enforced STRUCTURALLY (no trigger needed for this).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_published_revision_same_playbook'
  ) then
    alter table playbooks add constraint fk_published_revision_same_playbook
      foreign key (id, published_revision_id)
      references playbook_revisions (playbook_id, id);
  end if;
end
$$;

create table if not exists steps (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references playbook_revisions on delete cascade,
  "order" int not null,
  title jsonb not null,
  body jsonb,                    -- nullable: a step may be blocks-only; locale gate applies where present
  unique (revision_id, "order")
);

create table if not exists blocks (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references steps on delete cascade,
  "order" int not null,
  kind text not null check (kind in ('prompt','params','asset','note','link','workflow_file')),
  content jsonb not null,        -- discriminated per kind (§6.1)
  visibility visibility,         -- author override; NULL = inherit default_policy(kind)
  resolved_visibility visibility,-- stamped by prepare_publish
  unique (step_id, "order"),
  constraint blocks_content_min check (
    (kind = 'prompt'        and content ? 'text') or
    (kind = 'params'        and content ? 'rows') or
    (kind = 'asset'         and content ? 'asset') or
    (kind = 'note'          and content ? 'md') or
    (kind = 'link'          and content ? 'url') or
    (kind = 'workflow_file' and content ? 'asset')
  )
);

create table if not exists default_policy (
  kind text primary key,
  visibility visibility not null
);

insert into default_policy (kind, visibility) values
  ('asset','free'),
  ('note','free'),
  ('prompt','pro'),
  ('params','pro'),
  ('workflow_file','pro'),
  ('link','public')
on conflict (kind) do update set visibility = excluded.visibility;

-- ---------------------------------------------------------------------------
-- publish manifest (R3b): routing derived from stamped visibility, recorded in DB
-- ---------------------------------------------------------------------------
create table if not exists publish_assets (
  revision_id uuid not null references playbook_revisions on delete cascade,
  ref text not null,             -- block id or 'hero'
  sha256 text not null,
  source_staging_key text not null,
  target_bucket text not null check (target_bucket in ('public-content','content-published','artifacts-published')),
  target_key text not null,      -- {sha256}.{ext}
  copied_at timestamptz,
  primary key (revision_id, ref)
);

-- ---------------------------------------------------------------------------
-- billing
-- ---------------------------------------------------------------------------
create table if not exists subscriptions (
  user_id uuid primary key references profiles on delete cascade,
  stripe_subscription_id text unique not null,
  status text not null,          -- Stripe status verbatim; entitled iff IN ('active','past_due')
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  stripe_fetched_at timestamptz not null,  -- fetch-time fence: upserts apply only with a newer fetch
  updated_at timestamptz not null default now()
);

create table if not exists stripe_events (
  id text primary key,           -- Stripe event id; skip only if processed_at NOT NULL
  type text not null,
  created timestamptz not null,
  payload jsonb not null,
  processed_at timestamptz       -- NULL = pending/failed → retry sweep reprocesses
);

-- ---------------------------------------------------------------------------
-- notifications (schema now, delivery in M5)
-- ---------------------------------------------------------------------------
create table if not exists notification_jobs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references playbook_revisions,
  kind text not null check (kind in ('new_playbook','playbook_update')),
  created_at timestamptz not null default now(),
  unique (revision_id, kind)
);

create table if not exists notification_deliveries (
  job_id uuid not null references notification_jobs on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts int not null default 0,
  claimed_at timestamptz,        -- lease; recovery sweep: sending + claimed_at < now()-10min → pending
  sent_at timestamptz,
  primary key (job_id, user_id)
);

-- ---------------------------------------------------------------------------
-- analytics
-- ---------------------------------------------------------------------------
create table if not exists events (
  id bigint generated always as identity primary key,
  user_id uuid,
  type text not null check (type in ('view_playbook','hit_lock','start_checkout','unlock_success','hire_click')),
  playbook_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- read-path indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_playbooks_status_sort on playbooks (status, sort desc, created_at desc);
create index if not exists idx_revisions_playbook_state on playbook_revisions (playbook_id, state);
create index if not exists idx_steps_revision_order on steps (revision_id, "order");
create index if not exists idx_blocks_step_order on blocks (step_id, "order");
create index if not exists idx_publish_assets_revision on publish_assets (revision_id);
create index if not exists idx_events_created on events (created_at desc);
create index if not exists idx_deliveries_pending on notification_deliveries (status, claimed_at);
