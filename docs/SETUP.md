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

## 6. Stripe — blocks M3

1. Reuse the existing YAGI Stripe entity (§10). Create a **$9/month USD** recurring price.
2. `.env`: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`.
3. Webhook endpoint → `https://your-domain/api/stripe/webhook`, events
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Enable the customer portal (cancel + payment method).

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

# the M2 authz sweep — needs a server already running against the local snapshot
npm run db:local; npm run build; npm start      # in one shell
npm run sweep:anon                              # in another (SWEEP_BASE_URL to point elsewhere)
```

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
