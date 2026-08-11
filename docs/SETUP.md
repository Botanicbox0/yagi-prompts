# Setup — manual steps remaining after M0

M0 ships everything that can be built without external accounts. What follows needs a human with
console access. Each step is independent unless noted.

Local development works today with no external service: `npm install && npm run check && npm run dev`.

---

## 1. Supabase cloud project — blocks M5, and every manual auth/storage gate

The org's free-project limit (2) is used by `twiin` and `yagi-workshop`. Creating `playbook`
requires pausing one of them or upgrading the org — **Yagi's call** (PLAN §11).

1. Create the project (region closest to KR).
2. Copy `Project settings → API` into `.env.local`:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Copy `Project settings → Database → Connection string (URI)` into `DATABASE_URL`.
4. Apply the migrations **in filename order** — all of `supabase/migrations/*.sql`, core files
   first, then glue. Use the Supabase MCP `apply_migration` (one call per file, name it after the
   file) or the SQL editor.
5. Verify, in the SQL editor:
   ```sql
   select proname, pg_get_userbyid(proowner) as owner, prosecdef
     from pg_proc where proname in ('prepare_publish','publish_revision');
   -- expect owner = publisher, prosecdef = true for both
   select rolbypassrls from pg_roles where rolname = 'publisher';  -- expect true
   select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r';  -- expect t/t everywhere
   ```
   If `rolbypassrls` is false, run `alter role publisher with bypassrls;` as a superuser —
   otherwise every publish RPC fails under FORCE RLS. See `supabase/README.md`.

## 2. Google OAuth client — blocks the login round trip

The full code path exists (`/auth/signin` → Supabase OAuth → `/auth/callback` → session
middleware). Only the credentials are missing.

1. Google Cloud console → APIs & Services → Credentials → **OAuth 2.0 Client ID**, type *Web*.
2. Authorised redirect URI: `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
3. Supabase → Authentication → Providers → **Google**: paste client id + secret, enable.
4. Supabase → Authentication → URL Configuration → Site URL `https://your-domain`, and add
   `http://localhost:3000/**` plus the Vercel preview pattern to *Redirect URLs*.
5. Manual gate: sign in at `/auth/signin?next=/library&locale=ko` and confirm you land on
   `/library` with the KO locale cookie set.

## 3. Seed the fixtures

Against Supabase, `auth.users` belongs to GoTrue, so create the three fixture users first with the
Auth admin API (or the dashboard), keeping the ids in `scripts/fixtures.ts`:

| id | email | role |
|---|---|---|
| `f0000000-0000-4000-8000-000000000001` | free@playbook.test | free |
| `f0000000-0000-4000-8000-000000000002` | pro@playbook.test | pro (subscriptions row is seeded) |
| `f0000000-0000-4000-8000-000000000003` | admin@yagiworkshop.xyz | admin |

Then:

```powershell
npm run seed          # reads DATABASE_URL; SEED_CREATE_AUTH_USERS is off by default
```

`anon` is the absence of a user — there is nothing to create for it.

### Deferred: session-tier HTTP sweeps (M2)

`npm run sweep:anon` covers the **anonymous** tier completely against a real `next start`. The
free / pro / admin tiers are **not** swept over HTTP yet, and deliberately so: with no Supabase
project there is no way to mint a real session, and faking one would mean shipping a backdoor into
the very gate the sweep exists to verify. Those tiers are covered instead by the façade eligibility
matrix on PGlite (`tests/content/facade.test.ts`) and the gateway chain tests
(`tests/media/gateway.test.ts`), both of which inject a resolved viewer.

**TODO once step 1 and step 2 above are done** (tracked here, not in code):

1. Sign in as each fixture user and capture their session cookies.
2. Extend `scripts/sweep-anon.ts` with a `--tier` mode that replays those cookies, and assert:
   - **free**: `pro`/`hidden` sentinels absent, `public`/`free` present, `/library` renders 200;
   - **pro**: `hidden` sentinels absent, everything else present, workflow downloads 200 with
     `Content-Disposition: attachment`;
   - **Pro → free → anon on the same slug** in sequence, with no stale unlocked bytes on the later
     requests (PLAN §3.4 cache-contract acceptance).
3. Add the media gateway's 403 case for a signed-in free user on a `pro` block (the anon sweep only
   reaches the 401 case).

M3 note: `npm run dev:free` / `dev:pro` now make those tiers *renderable* locally, but they are not
sweepable — the sweep runs against `npm start` (production), where the dev identity does not exist.
The follow-up above still needs real sessions.

## 4. Promote an admin

`is_admin` is never derived from the email domain at runtime (§3.7 — "seeded manually"). Run:

```sql
update profiles set is_admin = true where email = 'yagi@yagiworkshop.xyz';
```

## 5. Storage buckets

`0101_glue_storage.sql` creates `content`, `public-content`, `content-published`,
`artifacts-published`. Confirm in Storage that only `public-content` is public, and that **no**
policies exist on `storage.objects` — deny-all is the intended posture.

Then implement `lib/storage/supabase-driver.ts` (the contract notes are in the file) and set
`STORAGE_DRIVER=supabase`. Until then the local driver writes under `.storage/`.

## 6. Stripe — the M3 manual gate

M3 ships the whole payment path against an injected boundary (`lib/billing/stripe-gateway.ts`), so
everything except *real money moving* is already verified offline: the fenced reconcile, the event
ledger and its retry sweep, the checkout guard, and **real webhook signature verification** against
the pinned SDK (`tests/billing/webhook-signature.test.ts`). What follows is the part that needs an
account.

1. Reuse the existing YAGI Stripe entity (§10). Create a **$9/month USD** recurring price.
2. `.env`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`. **All three Stripe variables are required
   together** — with any of them missing, `isBillingConfigured()` is false, checkout/portal answer a
   designed 503 and the CTAs render the "billing is not connected" panel. Nothing crashes.
3. Webhook endpoint → `https://your-domain/api/stripe/webhook`, events
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Enable the customer portal (cancel + payment method).
5. Schedule `npm run stripe:retry` (or call `retryUnprocessedEvents` from a cron/Edge function —
   it is exported for exactly that). It reprocesses `stripe_events` rows still carrying
   `processed_at IS NULL`. Nothing breaks without it; deliveries simply stay pending longer.

**Deferred manual gate — real test-mode checkout (§8 M3).** Once the keys exist: sign in on a
preview deploy, open a locked playbook, click through Stripe test-mode checkout with `4242…`, and
confirm you land back on the same playbook unlocked. Then, in the Stripe dashboard, cancel the
subscription and confirm `/account` reads "Cancelled" and the blocks re-lock. Note that
`/billing/success` reconciles on its own, so the first half passes **even with webhook delivery
disabled** — that is the design, and worth verifying by disabling the endpoint once.

**Stop-gate (§11)**: confirm $9/**month** and the refund wording before M3 merges.

## 7. Resend — blocks M5

API key into `RESEND_API_KEY`, verify the sending domain, then the cron worker per §3.5.

## 8. Deploy

Vercel project → import the repo → set every variable from `.env.example` (service role and
Stripe/Resend keys as **server-side only**). Naming and domain are a §11 stop-gate before M5.

---

## Quick reference

```powershell
npm install
npm run check      # typecheck + vitest — the same thing CI runs
npm test           # vitest only
npm run db:local   # local catalog snapshot (see below) — do this before `npm run dev`
npm run dev
npm run fonts      # re-vendor WOFF2 + licences after a font package bump
npm run seed       # fixture playbooks through the real prepare → copy → publish RPCs
npm run stripe:retry -- --dry   # count pending stripe_events (needs DATABASE_URL)

# the M2 authz sweep — needs a server already running against the local snapshot
npm run db:local; npm run build; npm start      # in one shell
npm run sweep:anon                              # in another (SWEEP_BASE_URL to point elsewhere)
```

**Port hygiene**: `npm start` leaves a detached `next-server` holding :3000 after the npm wrapper is
killed. Kill it by port, not by the npm process, or the next sweep silently runs against a stale
build (this is what produced M2's first false failure):

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## Render-verifying a SIGNED-IN view (M3)

There is no Supabase project (§11), so no session can be minted — which until M3 meant every locally
rendered page was anonymous, and `/account`, the Pro render and the whole checkout loop could not be
looked at. `scripts/dev-as.ts` closes that, without weakening anything:

```powershell
npm run db:local     # once — seeds the free / pro / admin fixture profiles
npm run dev:pro      # then open http://localhost:3000/account
npm run dev:free     # a free identity, for walking the conversion path
npm run dev:admin
```

What each flag does and does **not** do:

- `PLAYBOOK_DEV_IDENTITY` grants an **identity** (a `profiles.id` that must already exist in the
  snapshot). The **tier is still derived from that profile's real `subscriptions` row** by the same
  `resolveViewer` every request uses — `dev:pro` renders Pro because `db:local` seeded an `active`
  subscription, not because of the variable. The script prints the derived tier before starting, and
  refuses to start if the profile is not in the snapshot.
- `PLAYBOOK_FAKE_BILLING=1` (set automatically when no real `STRIPE_SECRET_KEY` is present) swaps in
  the deterministic fake gateway so checkout actually completes locally.
- **Both are dead code in a production build.** `next build` inlines `NODE_ENV === 'production'`, and
  `devIdentityUserId()` / `fakeBillingEnabled()` return null/false there. `npm start` — and therefore
  `npm run sweep:anon` — can never see either. Use `next dev` for a signed-in render; that is the
  design, not a limitation to work around.

The full M3 loop, walkable in a browser with `npm run dev:free`:

1. `http://localhost:3000/en/p/talking-character-clip` — 12 locked blocks, each CTA a checkout form
2. click **Unlock every prompt — $9/mo** → `POST /api/billing/checkout` → the fake session
3. → `/billing/success?session_id=…` reconciles → **redirects back to the same playbook, unlocked**
   (18 of 24 visible; the 6 remaining are `hidden`, which nobody below admin ever sees)
4. `/account` now reads **Pro — $9/month · Active · Renews …**, with a working "Manage billing"
5. click it again and the server guard sends you to the portal instead of a second subscription

Switching to `npm run dev:pro` shows the same account page for a fixture whose subscription was
seeded rather than purchased — there "Manage billing" reports `?portal=unavailable`, because that
row has no Stripe customer behind it and inventing a portal would be a lie.

### Media token secret

The media gateway signs its own ≤60s capability tokens (`lib/media/token.ts`). It uses
`MEDIA_TOKEN_SECRET` if set, falls back to `SUPABASE_SERVICE_ROLE_KEY`, and otherwise generates a
per-process random secret with a warning — fine for dev, but **set `MEDIA_TOKEN_SECRET` before
deploying** so tokens survive a restart and are not derived from an unrelated key.

## Local catalog data (no Supabase project required)

The landing and pricing pages read the catalog projection through `lib/content/public-catalog.ts`,
which resolves a `SqlRunner` in this order (`lib/db/connect.ts`):

1. `DATABASE_URL` → `pg` pool. The production path.
2. `.pglite/catalog.tar.gz` → an in-memory PGlite loaded from a dump. The dev path while §11's
   Supabase stop-gate is open.
3. neither → the empty catalog, and both pages render their designed empty states. CI builds
   exactly this way.

`npm run db:local` builds (2): a fresh PGlite, the real `*_core_*` migrations, and the real
prepare → copy → publish seed, dumped to `.pglite/catalog.tar.gz` (gitignored). A dump rather than
a live data directory so Next's parallel static-generation workers can each open their own
read-only copy without fighting over a file lock.

Re-run it whenever the migrations or `scripts/fixtures.ts` change. Fixture media lands under
`.storage/` via the local storage driver; nothing serves it over HTTP, so the cards render their
generated covers — see `docs/CONTENT-SLOTS.md`.
