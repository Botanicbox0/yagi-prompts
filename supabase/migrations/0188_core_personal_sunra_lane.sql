-- 클라우드 적용 필요 — TWINGS · core migration 0188 — the personal Sunra lane, schema only (pairs with 0189)
--
-- docs/PERSONAL-STUDIO.md §5.1, §6.1, §6.2 (PR A of the plan). Nothing in the deployed code writes or reads
-- these objects until `TWINGS_PERSONAL_SUNRA_FACES=on`; the lane's gate (lib/renders/sunra-lane.ts) checks for
-- every one of them first and stays closed on a database without this file. Apply this file and 0189 back to
-- back in one session. Safe to apply twice. Existing rows are not rewritten.
--
--   render_jobs (~)             `provider` also accepts 'sunra' (0017, widened in 0061). The check is replaced
--                               NOT VALID and validated after: every existing value is one of the old four, so
--                               the validation cannot fail, and it scans under a weaker lock.
--   adult_confirmations (+)     one row per account, written once when the person first states their birth year
--                               and the "만 19세 이상" confirmation (§6.1, proposal). A first failing answer is
--                               kept; changing it is an admin operation. Server only (0189).
--   render_slot_inputs (~)      `photo_check` (the partner-photo verdict, JSON) and `photo_checked_at` (§6.2).
--                               Null on every existing row; both are set together or not at all.
--   render_provider_state (+)   the Sunra circuit in one row (lib/renders/provider-router.ts states). The router
--                               keeps it in process memory, which serverless loses; this row is what the gate reads.

set lock_timeout = '3s';

-- 1. render_jobs.provider learns 'sunra' -------------------------------------------------------------------

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'render_jobs_provider_check'
       and conrelid = 'public.render_jobs'::regclass
       and pg_get_constraintdef(oid) like '%''sunra''%'
  ) then
    alter table render_jobs drop constraint if exists render_jobs_provider_check;
    alter table render_jobs
      add constraint render_jobs_provider_check
      check (provider is null or provider in ('openai', 'modelark', 'kling', 'google', 'sunra')) not valid;
  end if;
end $$;

alter table render_jobs validate constraint render_jobs_provider_check;

-- 2. adult_confirmations ---------------------------------------------------------------------------------

create table if not exists adult_confirmations (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birth_year smallint not null constraint adult_confirmations_birth_year_range check (birth_year between 1900 and 2100),
  -- The "만 19세 이상입니다" box as it was sent: a false answer is kept like a true one.
  attested boolean not null,
  attested_at timestamptz not null default now()
);

-- 3. render_slot_inputs: the partner-photo check -------------------------------------------------------------

alter table render_slot_inputs
  add column if not exists photo_check jsonb,
  add column if not exists photo_checked_at timestamptz;

do $$ begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'render_slot_inputs_photo_check_shape'
       and conrelid = 'public.render_slot_inputs'::regclass
  ) then
    alter table render_slot_inputs
      add constraint render_slot_inputs_photo_check_shape check (
        (photo_check is null and photo_checked_at is null)
        or (photo_check is not null and photo_checked_at is not null and jsonb_typeof(photo_check) = 'object')
      ) not valid;
  end if;
end $$;

alter table render_slot_inputs validate constraint render_slot_inputs_photo_check_shape;

-- 4. render_provider_state: the Sunra circuit ------------------------------------------------------------------

create table if not exists render_provider_state (
  provider text primary key constraint render_provider_state_provider_known check (provider in ('sunra')),
  circuit_state text not null default 'closed'
    constraint render_provider_state_circuit_known
    check (circuit_state in ('closed', 'open_price_drift', 'open_insufficient_hold', 'open_provider_outage')),
  reason text,
  opened_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint render_provider_state_opened check (circuit_state = 'closed' or opened_at is not null)
);
