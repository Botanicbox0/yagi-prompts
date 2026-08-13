-- PLAYBOOK · M10 · core migration 0008
-- PLAN §15.2 — the cookie wallet: `profiles.cookie_balance` + `profiles.cookies_granted_at`,
-- `prompt_unlocks`, `cookie_ledger`.
--
-- The design splits one fact across two shapes on purpose: `cookie_balance` is the FAST READ the
-- detail page and the unlock guard consult, and `cookie_ledger` is the append-only TRUTH a support
-- question is answered from. Every write path (lib/cookies/repo.ts) moves both inside one
-- transaction under a `profiles` row lock, so the pair can only drift if someone writes SQL by
-- hand — and then the ledger is the side that says what actually happened.
--
-- No new SQL function anywhere in this file (the 0103 lesson, applied the same way 0007 applied
-- it): a `public` function is a PostgREST `/rpc` surface handed to anon/authenticated by default
-- privileges. The weekly grant, the idempotent unlock and the purchase credit are all TypeScript
-- inside `SqlRunner.transaction()`, which also keeps them testable on PGlite.

-- ---------------------------------------------------------------------------
-- profiles: the wallet columns (§15.1-2, §15.1-3)
-- ---------------------------------------------------------------------------
-- The ADD COLUMN itself is the backfill: `not null default 3` stamps every EXISTING row with 3 at
-- the moment the column appears (Postgres fills a non-volatile default in place), which is exactly
-- the §15.1-2 grant for accounts that predate cookies. New rows get the same 3 from the default —
-- the signup grant, without the callback having to know the number.
alter table profiles add column if not exists cookie_balance int not null default 3;

-- NULL means "the weekly clock has never been read": a backfilled profile's first wallet read
-- grants the return cookie and starts the clock (§15.1-3). The auth callback stamps it at profile
-- creation so a brand-new account reads exactly 3, not 3-plus-an-immediate-weekly.
alter table profiles add column if not exists cookies_granted_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_cookie_balance_nonneg') then
    alter table profiles
      add constraint profiles_cookie_balance_nonneg
      check (cookie_balance >= 0);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- prompt_unlocks (§15.1-1) — "spending a cookie opens that prompt forever"
-- ---------------------------------------------------------------------------
create table if not exists prompt_unlocks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles on delete cascade,
  prompt_id uuid not null references prompt_items on delete cascade,
  created_at timestamptz not null default now(),

  -- The uniqueness IS the idempotency: a second spend on the same prompt has no row to insert,
  -- and the unlock path answers 'alreadyUnlocked' without touching the balance.
  unique (profile_id, prompt_id)
);

-- `/account`'s "prompts you opened" list, newest first.
create index if not exists idx_prompt_unlocks_profile
  on prompt_unlocks (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- cookie_ledger (§15.2) — append-only audit; the balance column is the cache
-- ---------------------------------------------------------------------------
create table if not exists cookie_ledger (
  id bigint generated always as identity primary key,
  profile_id uuid not null references profiles on delete cascade,
  delta int not null,
  reason text not null,
  -- `set null` rather than cascade: deleting a prompt must not erase the record that a cookie was
  -- spent — the spend happened, whatever later became of the thing it bought.
  prompt_id uuid references prompt_items on delete set null,
  created_at timestamptz not null default now(),

  -- A zero-delta row is a ledger entry that says nothing; refuse it at the door.
  constraint cookie_ledger_delta_nonzero
    check (delta <> 0),

  -- The four verbs of §15: the signup grant, the weekly grant, the $4 pack, the spend.
  constraint cookie_ledger_reason_known
    check (reason in ('signup', 'weekly', 'purchase', 'unlock'))
);

-- The support question: "what happened to this account's cookies", newest first.
create index if not exists idx_cookie_ledger_profile
  on cookie_ledger (profile_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Backfill the ledger to MATCH the backfilled balance (M10 review R1, finding 1)
-- ---------------------------------------------------------------------------
-- The ADD COLUMN above stamped every pre-cookie profile with balance 3; without this row their
-- ledger would sum to 0 while the balance reads 3 — the "ledger is the truth" claim broken on
-- day one. One idempotent row per profile that has never been granted a signup: re-running the
-- file cannot double-book, and profiles created AFTER this migration get their row from the auth
-- callback's create-profile transaction instead.
insert into cookie_ledger (profile_id, delta, reason)
select p.id, 3, 'signup'
  from profiles p
 where not exists (
   select 1 from cookie_ledger l where l.profile_id = p.id and l.reason = 'signup'
 );

-- ---------------------------------------------------------------------------
-- cookie_purchase_events (§15.1-5) — webhook idempotency, built BEFORE the money exists
-- ---------------------------------------------------------------------------
-- (M10 review R1, finding 2.) A merchant-of-record webhook redelivers; two deliveries of one $4
-- payment must credit 5 cookies once, not 10. The provider's event id is claimed here FIRST,
-- under the primary key, inside the same transaction that credits — the second delivery finds
-- its claim taken and answers 'duplicate' without touching the wallet.
create table if not exists cookie_purchase_events (
  event_id text primary key,
  profile_id uuid not null references profiles on delete cascade,
  cookies int not null,
  created_at timestamptz not null default now(),

  constraint cookie_purchase_events_positive
    check (cookies > 0),
  constraint cookie_purchase_events_id_present
    check (btrim(event_id) <> '')
);

create index if not exists idx_cookie_purchase_events_profile
  on cookie_purchase_events (profile_id, created_at desc);
