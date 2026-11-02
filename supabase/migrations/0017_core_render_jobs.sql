-- PLAYBOOK · core migration 0017 — render jobs (docs/TEMPLATES-IA.md §8, 2026-09-06)
--
-- Founder direction: "유저가 seedance 영상 생성을 기다려야하는 프로세스가 분명 존재하는데 … 링크를
-- 카톡이나 아니면 메일로 보내주는 절차를 하나 넣을까? (link는 3일내로 expire되는 느낌으로)".
--
-- A render is a JOB, not a request: the photo goes into private storage, a row is queued, an
-- engine runs (seconds for an image, minutes for a film), the result is copied into our storage
-- the moment the provider hands it over, and the person is told where it is. Everything that
-- decides what the reader sees hangs off this one row:
--
--   status         queued → running → succeeded | failed   (a retryable failure goes back to queued)
--   share_token    the capability inside the completion message — `/r/{id}/{token}`, no login,
--                  dead after `share_expires_at` (3 days); the owner keeps `/renders/{id}` forever
--   notify_*       the delivery of that message, per channel (email today; 알림톡 / WhatsApp are
--                  the same row with a different `notify_channel` — the design is channel-agnostic
--                  on purpose, see docs/TEMPLATES-IA.md §8.1)
--
-- Money: `cost_usd` is what the provider actually billed (or the estimate when it reports only
-- tokens), booked per job so the margin per template is a query, not a guess.

create table if not exists render_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  template_id uuid not null references prompt_items on delete restrict,
  template_slug text not null,
  medium text not null check (medium in ('video','image')),
  engine text not null,
  aspect text not null,
  locale text not null default 'en' check (locale in ('en','ko')),
  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed')),
  -- The visitor's photo (private storage key + mime); null for a text-only render.
  input_key text,
  input_mime text,
  -- The finished object, copied into OUR storage — never a provider URL (those expire in 24h).
  result_key text,
  result_mime text,
  result_bytes bigint check (result_bytes is null or result_bytes >= 0),
  provider text check (provider is null or provider in ('openai','modelark')),
  -- The provider's own task id for asynchronous engines (ModelArk `cgt-…`); polled until terminal.
  provider_task_id text,
  attempts int not null default 0 check (attempts >= 0),
  error_code text,
  error_message text,
  cost_usd numeric(10,4) check (cost_usd is null or cost_usd >= 0),
  -- The 3-day capability. Unique so a token resolves to exactly one job without the id.
  share_token text unique,
  share_expires_at timestamptz,
  notify_status text not null default 'pending'
    check (notify_status in ('pending','sent','skipped','failed')),
  notify_channel text not null default 'email'
    check (notify_channel in ('email','kakao','whatsapp','sms')),
  notify_attempts int not null default 0 check (notify_attempts >= 0),
  notified_at timestamptz,
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A finished job carries its result and its link; a failed one says why.
  constraint render_jobs_succeeded_complete
    check (status <> 'succeeded'
           or (result_key is not null and result_mime is not null and share_token is not null and finished_at is not null)),
  constraint render_jobs_failed_has_code
    check (status <> 'failed' or coalesce(btrim(error_code), '') <> ''),
  constraint render_jobs_share_pair
    check ((share_token is null) = (share_expires_at is null)),
  constraint render_jobs_input_pair
    check ((input_key is null) = (input_mime is null))
);

-- The owner's list, newest first.
create index if not exists render_jobs_user_idx on render_jobs (user_id, created_at desc);
-- The worker's queue: what is still open, oldest first.
create index if not exists render_jobs_open_idx on render_jobs (status, created_at)
  where status in ('queued','running');
-- The provider's callback names a task, not a job.
create index if not exists render_jobs_provider_task_idx on render_jobs (provider_task_id)
  where provider_task_id is not null;
-- Messages still to send, so a later-configured mailer can catch up.
create index if not exists render_jobs_notify_idx on render_jobs (notify_status, finished_at)
  where notify_status = 'pending';

drop trigger if exists trg_render_jobs_updated_at on render_jobs;
create trigger trg_render_jobs_updated_at before update on render_jobs
  for each row execute function set_updated_at();
