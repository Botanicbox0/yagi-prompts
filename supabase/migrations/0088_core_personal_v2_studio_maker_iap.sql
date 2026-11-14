-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0088 — Personal v2 Studio, Hydrogen Director, Keyframes, Open Maker & Store IAP
--
-- Apply this file alongside 0163_glue_personal_v2_studio_maker_iap.sql before deploying code that reads or
-- writes these columns/tables.

-- 1. Selective image set + Hydrogen director spec on billing_payments & render_jobs
alter table billing_payments
  add column if not exists selected_frames integer[],
  add column if not exists director_spec jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_payments_selected_frames_nonempty') then
    alter table billing_payments add constraint billing_payments_selected_frames_nonempty
      check (selected_frames is null or coalesce(array_length(selected_frames, 1), 0) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'billing_payments_director_spec_obj') then
    alter table billing_payments add constraint billing_payments_director_spec_obj
      check (director_spec is null or jsonb_typeof(director_spec) = 'object');
  end if;
end $$;

alter table render_jobs
  add column if not exists selected_frames integer[],
  add column if not exists director_spec jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'render_jobs_selected_frames_nonempty') then
    alter table render_jobs add constraint render_jobs_selected_frames_nonempty
      check (selected_frames is null or coalesce(array_length(selected_frames, 1), 0) > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'render_jobs_director_spec_obj') then
    alter table render_jobs add constraint render_jobs_director_spec_obj
      check (director_spec is null or jsonb_typeof(director_spec) = 'object');
  end if;
end $$;

-- 2. Render slot inputs widened for look/prop/scene customization references
do $$
declare
  cname text;
begin
  for cname in
    select c.conname from pg_constraint c
    where c.conrelid = 'render_slot_inputs'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%pet%'
      and pg_get_constraintdef(c.oid) like '%partner%'
  loop
    execute format('alter table render_slot_inputs drop constraint %I', cname);
  end loop;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'render_slot_inputs_slot_known') then
    alter table render_slot_inputs add constraint render_slot_inputs_slot_known
      check (slot in ('pet', 'partner', 'look_ref', 'prop_ref', 'scene_ref'));
  end if;
end $$;

-- 3. Maker assets widened for audio + 25 MiB limit + person containment flag (portrait original view-only safety)
alter table platform_format_assets
  add column if not exists contains_person boolean not null default false;

do $$
declare
  cname text;
begin
  for cname in
    select c.conname from pg_constraint c
    where c.conrelid = 'platform_format_assets'::regclass and c.contype = 'c'
      and c.conname not in (
        'platform_format_assets_id_check',
        'platform_format_assets_role_check',
        'platform_format_assets_sha256_check'
      )
  loop
    execute format('alter table platform_format_assets drop constraint %I', cname);
  end loop;
end $$;

alter table platform_format_assets
  add constraint platform_format_assets_kind_check
    check (kind in ('image', 'video', 'audio')),
  add constraint platform_format_assets_mime_check
    check (mime in (
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime',
      'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac'
    )),
  add constraint platform_format_assets_bytes_check
    check (
      bytes > 0 and (
        (kind = 'image' and bytes <= 4194304) or
        (kind in ('video', 'audio') and bytes <= 26214400)
      )
    ),
  add constraint platform_format_assets_kind_mime_match
    check (
      (kind = 'image' and mime like 'image/%') or
      (kind = 'video' and mime like 'video/%') or
      (kind = 'audio' and mime like 'audio/%')
    );

-- 4. Video keyframe strip metadata on maker formats and published prompts
alter table platform_formats
  add column if not exists keyframes jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'platform_formats_keyframes_array') then
    alter table platform_formats add constraint platform_formats_keyframes_array
      check (keyframes is null or jsonb_typeof(keyframes) = 'array');
  end if;
end $$;

alter table prompt_items
  add column if not exists keyframes jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'prompt_items_keyframes_array') then
    alter table prompt_items add constraint prompt_items_keyframes_array
      check (keyframes is null or jsonb_typeof(keyframes) = 'array');
  end if;
end $$;

-- 5. Open Maker 1-click OWL-P likeness & rights attestation columns on platform_creators
alter table platform_creators
  add column if not exists attested_at timestamptz,
  add column if not exists attestation_version text;

-- 6. App Store & Google Play IAP credit wallets and verified transaction ledger (mobile-store isolated)
create table if not exists store_iap_wallets (
  user_id uuid primary key references profiles(id) on delete cascade,
  credits_balance integer not null default 0 check (credits_balance >= 0),
  lifetime_purchased integer not null default 0 check (lifetime_purchased >= 0),
  lifetime_spent integer not null default 0 check (lifetime_spent >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_store_iap_wallets_updated_at on store_iap_wallets;
create trigger trg_store_iap_wallets_updated_at before update on store_iap_wallets
  for each row execute function set_updated_at();

create table if not exists store_iap_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  product_id text not null,
  transaction_id text not null,
  purchase_token text,
  kind text not null default 'purchase' check (kind in ('purchase', 'spend', 'refund', 'restore')),
  credits_delta integer not null check (credits_delta <> 0),
  status text not null default 'verified' check (status in ('pending', 'verified', 'refunded', 'rejected')),
  environment text not null default 'production' check (environment in ('sandbox', 'production', 'local')),
  render_id uuid references render_jobs(id) on delete set null,
  receipt_meta jsonb not null default '{}'::jsonb check (jsonb_typeof(receipt_meta) = 'object'),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, transaction_id)
);

create index if not exists idx_store_iap_transactions_user
  on store_iap_transactions (user_id, created_at desc);

-- 7. Backfill measured 1440x1080 (4:3) dimensions on giant-daydream ("작은 방의 백일몽") hero showcase film
update prompt_items
set media = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(media, '{video,w}', '1440'::jsonb, true),
      '{video,h}', '1080'::jsonb, true
    ),
    '{poster,w}', '1440'::jsonb, true
  ),
  '{poster,h}', '1080'::jsonb, true
)
where slug = 'giant-daydream'
  and media is not null
  and jsonb_typeof(media->'video') = 'object'
  and jsonb_typeof(media->'poster') = 'object'
  and (media->'poster'->>'w' is null or media->'video'->>'w' is null);
