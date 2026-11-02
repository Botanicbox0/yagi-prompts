-- CLOUD APPLICATION REQUIRED. Founder 2026-10-22: no generated reference portrait any more.
-- A creator keeps natural front-facing photos of THEMSELF — up to IDENTITY_SELFIE_LIMIT (default 1,
-- at most 10) — and every order picks one of them ("이 얼굴로 만들까요?", docs/IDENTITY-SELFIE.md).
-- The limit is checked by the service under the owner's profile-row lock, not by this schema, so the
-- founder can raise it in Vercel once the terms say so; every photo is the same person, one
-- person-asset group per account (terms §5.3).
-- The generated-portrait tables (0028/0029) are kept read-only for the lineage of paid jobs that
-- already reference them (docs/IDENTITY-SELFIE.md). No new rows are written to them.
create table identity_selfies (
  id uuid primary key,
  user_id uuid not null references profiles on delete cascade,
  -- Private `renders` bucket key: `{id}/selfie.png` (EXIF stripped, orientation applied).
  input_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- The photo the studio offers first. Exactly one among the active photos (the service keeps the
  -- "at least one" half under the profile lock; the index below holds the "at most one" half).
  is_default boolean not null default false,
  -- When an order last copied this photo's bytes.
  last_used_at timestamptz,
  -- The owner's own note ("안경", "긴 머리"); shown to nobody else.
  label text check (label is null or char_length(label) between 1 and 40),
  -- Replacing closes the old row; paid jobs keep their own byte copy and this id.
  replaced_at timestamptz,
  -- Deleting is soft: the row and `{id}/selfie.png` stay until the account-deletion runbook removes them.
  deleted_at timestamptz,
  unique(user_id, id),
  constraint identity_selfies_default_active check (not is_default or (deleted_at is null and replaced_at is null))
);
-- One default among the active photos. There is deliberately no "one photo per account" index any more.
create unique index identity_selfie_default on identity_selfies(user_id) where is_default and deleted_at is null and replaced_at is null;
create index identity_selfie_owner on identity_selfies(user_id, created_at desc);
-- Lineage: which saved photo an order/job copied its input from. Nullable: an operator's direct upload has none.
alter table billing_payments add column identity_selfie_id uuid references identity_selfies(id) on delete set null;
alter table render_jobs add column identity_selfie_id uuid references identity_selfies(id) on delete set null;
-- Carry over each account's CHOSEN generated portrait as its default photo, so nobody who already
-- finished the old flow uploads again (the PG review account above all: its chosen picture stays
-- the one it pays with, docs/qa/toss-checkout/REVIEW-ACCOUNT.md). The bytes are not copied: the
-- selfie row points at the portrait's own result object, which stays in the private bucket.
-- The hash is of the object key (SQL cannot read the bytes); a real upload never matches it, so the
-- first new selfie simply replaces (or, under a higher limit, joins) the carried-over row.
insert into identity_selfies (id, user_id, input_key, sha256, width, height, consent_at, created_at, is_default)
select gen_random_uuid(), s.user_id, a.result_key,
  encode(sha256(convert_to(a.result_key, 'utf8')), 'hex'),
  case when a.model = 'dola-seedream-5-0-pro-260628' then 1664 else 1344 end,
  case when a.model = 'dola-seedream-5-0-pro-260628' then 2496 else 2016 end,
  a.consent_at, s.updated_at, true
from identity_portrait_selections s
join identity_portrait_attempts a on a.id = s.attempt_id and a.user_id = s.user_id
where a.status = 'succeeded' and a.result_key is not null;
