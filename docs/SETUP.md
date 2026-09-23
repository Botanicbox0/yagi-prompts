# TWINGS 환경 설정

기본 작업 경로는 `D:\dev\twings`입니다. 작업용 worktree와 보관 폴더 구분은 [WORKSPACE.md](WORKSPACE.md)를 확인하세요.

로컬 개발은 외부 서비스 없이 `npm install`, `npm run check`, `npm run db:local`, `npm run dev`로 시작할 수 있습니다. 실제 연결 검증은 별도입니다.

제품명은 **TWINGS**입니다. 기존 npm 패키지명, `PLAYBOOK_*` 환경변수, DB 테이블 식별자는 호환성을 위해 유지합니다. 아래 M0~M7 표기는 초기 구축 기록이므로 현재 연결·배포 상태는 실제 환경에서 다시 확인합니다.

---

## 0. Local or cloud — the one switch (M7)

`.env.local` now carries live Supabase credentials, and Next reads it for `dev`, `build` **and**
`start`. Without a switch, every offline flow (the PGlite snapshot, the fixture identities, the anon
sweep, CI) would silently start reading the live database and writing to live buckets. So:

| `PLAYBOOK_MODE` | Database | Storage | Public bucket URLs |
|---|---|---|---|
| `local` | PGlite — `PLAYBOOK_LOCAL_DB_DIR` if set, else `.pglite/catalog.tar.gz` | `.storage/` | none (cards fall back to the gateway/generated cover) |
| `cloud` | `pg` against `DATABASE_URL` | Supabase buckets, service role | `{project}/storage/v1/object/public/public-content/{key}` |
| *unset* | inferred: `DATABASE_URL` present ⇒ cloud, absent ⇒ local | follows the mode | follows the mode |

**Precedence, highest first:**

1. `STORAGE_DRIVER=local|supabase` — a per-driver override, for mixing (cloud DB + local bytes).
   Escape hatch; leave it unset. It is **not** set by `.env.example` any more, precisely so a copied
   env file cannot pin a deployment to the local driver.
2. `PLAYBOOK_MODE=local|cloud` — the switch. An unrecognised value warns once and falls through.
3. `DATABASE_URL` — the legacy inference, unchanged from M0–M6.

`local` **ignores a present `DATABASE_URL` entirely**; that is the whole point. The selection is a
pure function in `lib/runtime-mode.ts` and its matrix is pinned in `tests/runtime/mode.test.ts`.

Which flows force which mode:

| Command | Mode | Why |
|---|---|---|
| `npm run db:local` | forced `local` | it *builds* the offline database |
| `npm run dev:free\|pro\|admin` | forced `local` | the fixture identities exist only in the snapshot |
| `npm run build:local` / `npm run start:local` | forced `local` | the offline proof: build + serve + `sweep:anon` |
| `npm run sweep:anon` | forced `local` | its oracle is the snapshot; point it at a `start:local` server |
| CI (all jobs) | forced `local` (workflow `env:`) | hermetic by declaration, not by the absence of secrets |
| `npm run dev` / `npm run build` / `npm start` | inferred → cloud | what a deployment wants |
| `npm run cloud:smoke` | forced `cloud` | it exists to talk to the live project |

---

## 1. Supabase cloud project — DONE (2026-08-13)

Project `yagi-prompts`, ref `nhokkikjkzjalxqsbzuk`, region `ap-northeast-2`. All ten migrations
applied (including `0103_glue_supabase_hardening.sql`), four buckets created, 13 public tables.
`npm run cloud:smoke` re-verifies all of that in about two seconds — run it rather than re-reading
this paragraph.

The steps below are kept as the recipe for the next environment (a staging project, a rebuild).

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

Team accounts need nothing (2026-09-24, 대표 결정). `0038_core_staff_admin.sql` makes every account
whose `auth.users` email the auth server confirmed on exactly `@yagiworkshop.xyz` an admin, at the
first profile insert, at email confirmation and at an email change, and revokes that grant when the
email leaves the domain. Unconfirmed addresses, subdomains, suffixes, look-alike characters and
`profiles.email` never count. `profiles.admin_source` records why: `staff_email` or `manual`.

Anyone else is promoted by hand, which records `manual` and is never revoked automatically:

```sql
update profiles set is_admin = true where id = '<auth user id>';
```

An automatic grant already reads `is_admin = true`, so to pin it as manual set
`admin_source = 'manual'` explicitly.

Offboarding a team member: ban the auth user (Dashboard → Authentication → Ban), delete it, or change
its email off the domain. A ban or email change revokes a `staff_email` grant in the same auth write;
deletion removes the profile through its foreign key. A `manual` grant survives a ban or email change:
also run `update profiles set is_admin = false where id = '<auth user id>';`.
Google/Kakao report an address as verified once proven, so a former member's personal account still
carrying the work address qualifies until one of these steps is taken.

To find an account that should have been promoted but was not, compare `auth.users` with
`is_twings_staff_email(email) and email_confirmed_at is not null` (not deleted, not banned). A team admin is still never a
buyer: quote acceptance and payment stay with the brand's own owner or recorded buyer
(`lib/brands/usage/core.ts isBuyer`).

## 5. Storage buckets

`0101_glue_storage.sql` creates `content`, `public-content`, `content-published`,
`artifacts-published`. Confirm in Storage that only `public-content` is public, and that **no**
policies exist on `storage.objects` — deny-all is the intended posture. (`npm run cloud:smoke`
asserts all four buckets and their `public` flags from `storage.buckets`.)

`lib/storage/supabase-driver.ts` is implemented as of M7 and is selected by `PLAYBOOK_MODE=cloud` —
there is no longer a `STORAGE_DRIVER` line to set. It keeps the local driver's semantics exactly:
`upsert:false` copies (an existing content-addressed key is success, never an overwrite), ≤60s
signed URLs, and **no delete method**. Do not add one; write-once is a security property (§6). The
one legitimate staging delete lives in `scripts/cloud-smoke.ts`, which cleans up its own probe with
a raw client and never touches a published bucket.

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

## 7. Resend — the M5 manual gate

M5 ships the whole notification pipeline against an injected boundary
(`lib/notify/mailer.ts`), so everything except *mail actually leaving the building* is verified
offline: job enqueue, expansion, claim/lease/recovery, backoff, idempotency keys, unsubscribe
tokens, and both bilingual templates. What follows is the part that needs an account.

1. Resend → add the sending domain → publish the DKIM/SPF records → wait for **Verified**.
2. `.env`: `RESEND_API_KEY` and `NOTIFY_FROM_EMAIL` (e.g. `PLAYBOOK <playbook@your-domain>`).
   **Both are required together** — with either missing, `getMailer()` is null, the worker claims
   nothing and reports `mailer NOT CONFIGURED`. Nothing is marked sent that was not sent.
3. `NOTIFY_TOKEN_SECRET` — any long random string. It signs the unsubscribe links, which live in
   people's inboxes for months; if it is unset the process generates a random one at boot and every
   link stops working on the next restart.
4. Schedule the worker every minute (Vercel Cron, or a Supabase Edge Function calling
   `runNotifyPass` from `lib/notify/worker.ts` — it is exported for exactly that):
   `npm run notify:worker`. Nothing breaks without it; deliveries simply stay `pending`.
5. Manual gate (§8 M5): from `/admin`, publish a revision with **Email subscribers** ticked, run the
   worker, and read both emails in a real inbox — one EN, one KO. Check the change note appears on
   the update, click the unsubscribe link, and confirm `/account` shows the switch off.

## 8. Deploy to Vercel

Nothing here is automated, and M7 deliberately does **not** deploy — this is the recipe plus the
checks that say it worked.

**Project settings**

| Setting | Value |
|---|---|
| Framework preset | Next.js (auto-detected) |
| Build command | `npm run build` — *not* `build:local`; the plain script infers cloud from `DATABASE_URL`, and `PLAYBOOK_MODE=cloud` below makes it explicit |
| Install command | `npm ci` (lockfile is authoritative — see `docs/VERSIONS.md`) |
| Output | `.next` (default) |
| Node | 22.x or 24.x (`engines` requires ≥ 22) |
| Root directory | repo root |

**Environment variables** (names only — copy the values from `.env.local` / the provider consoles;
everything except the three `NEXT_PUBLIC_*` names is **server-side only** and must never be exposed
to the browser):

| Variable | Scope | Notes |
|---|---|---|
| `PLAYBOOK_MODE` | all | **`cloud`.** Not strictly required (`DATABASE_URL` implies it) but set it: it makes the intent explicit and survives a future change to the inference. |
| `NEXT_PUBLIC_SUPABASE_URL` | all | public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all | public by design; RLS is deny-all |
| `SUPABASE_SERVICE_ROLE_KEY` | server | the data client and the storage driver |
| `DATABASE_URL` | server | Supabase → Database → Connection string (URI). Use the **pooled** connection for serverless. |
| `NEXT_PUBLIC_APP_URL` | all | the real origin, no trailing slash. Sitemap, robots, `metadataBase`/OG and every email link resolve against it. |
| `MEDIA_TOKEN_SECRET` | server | ≤60s media capabilities; must be stable across restarts |
| `NOTIFY_TOKEN_SECRET` | server | signs unsubscribe links that live in inboxes for months — **never rotate casually** |
| `STRIPE_SECRET_KEY` | server | all three Stripe vars are required together, or billing renders its "not connected" panel |
| `STRIPE_WEBHOOK_SECRET` | server | from the endpoint created in §6 |
| `STRIPE_PRICE_PRO` | server | the $9/month price id |
| `RESEND_API_KEY` | server | with `NOTIFY_FROM_EMAIL`, or the worker sends nothing |
| `NOTIFY_FROM_EMAIL` | server | e.g. `YAGI PROMPTS <prompts@your-domain>` |
| `OPENAI_API_KEY` / `ARK_API_KEY` | server | the render engines (docs/TEMPLATES-IA.md §7–8); a missing key fails a job with `no_engine_key`, never a 500 |
| `CRON_SECRET` | server | optional; any long random string. Vercel sends it as the bearer token on `/api/renders/tick`; without it the tick is open but idempotent |

Do **not** set `STORAGE_DRIVER`, `PLAYBOOK_LOCAL_DB`, `PLAYBOOK_LOCAL_DB_DIR` or
`PLAYBOOK_DEV_IDENTITY` in Vercel. The first would override the mode; the middle two are PGlite
paths that do not exist there; the last is dead code in a production build and setting it would only
confuse the next reader.

**Post-deploy checklist** — in order, each with its own check:

1. **Supabase Auth → URL Configuration**: Site URL = the production origin, and add
   `https://your-domain/**` *plus* the Vercel preview pattern (`https://*-yourteam.vercel.app/**`)
   to Redirect URLs. Check: `/auth/signin?next=/library&locale=ko` on the deployed domain lands on
   `/library` with the KO cookie — not on a Supabase error page.
2. **Google OAuth client**: the authorised redirect URI is the *Supabase* callback
   (`https://nhokkikjkzjalxqsbzuk.supabase.co/auth/v1/callback`), never the app's. Check: the
   `google` line in `npm run cloud:smoke` reads `true`.
3. **Stripe webhook endpoint** → `https://your-domain/api/stripe/webhook` with the four events from
   §6, and its signing secret into `STRIPE_WEBHOOK_SECRET`. Check: Stripe's "Send test webhook"
   returns 2xx, and the event appears in `stripe_events` with `processed_at` set.
4. **OG / metadata**: fetch `https://your-domain/en` and confirm `og:url`, `og:image` and the
   canonical are absolute on the real host (they come from `NEXT_PUBLIC_APP_URL` via
   `lib/seo/site-url.ts`). A `localhost` in any of them means the variable is missing.
5. **Sitemap + robots**: `/sitemap.xml` and `/robots.txt` carry the real origin; `/prompts/submit`,
   `/admin` and `/api` are disallowed; the gallery is not.
6. **Anon sweep against production**: `SWEEP_BASE_URL=https://your-domain npm run sweep:anon`.
   Note this needs the production database to hold the same fixtures the sweep's oracle expects —
   against a launch database it is the *shape* checks (headers, redirects, refusals) that carry, not
   the sentinel ones.
7. **Purge the build cache on a data-source switch.** Next persists `unstable_cache` results in
   `.next/cache` *across builds*, so the first deploy after pointing at a different database can
   serve the previous one's catalog. Vercel → Deployments → Redeploy with "use existing build cache"
   **off**. (This bit M7's first cloud-build proof locally: a cloud build reused the local build's
   cached catalog and rendered fixture data.)

---

## Go-live checklist (§11 stop-gates, in order)

Everything above is a description; this is the running order. Each line has a check you can actually
perform — a step is not done because you did it, it is done because the check passed.

| # | Step | Blocks | Verify |
|---|---|---|---|
| 1 | **Name decided: YAGI PROMPTS** (2026-08-13) — domain still open | everything below | the domain resolves and you own the DNS |
| 2 | ~~**Supabase project** created (§1)~~ **DONE** — `yagi-prompts` / `nhokkikjkzjalxqsbzuk` | 3–6, 10 | `npm run cloud:smoke` → `db select 1` PASS |
| 3 | ~~**Migrations applied in filename order**~~ **DONE** — all ten, core then `*_glue_*` | 4–6 | `npm run cloud:smoke` → 13 tables, four buckets, `prepare_publish` executable by `service_role` and NOT by anon/authenticated |
| 4 | **Service role key** into `SUPABASE_SERVICE_ROLE_KEY` (server-side only) — **still empty in `.env.local`** | 5–6, the storage half of the smoke | `npm run cloud:smoke` reports 0 skipped |
| 5 | **Google OAuth client** + Supabase redirect URLs (§2) | login | `/auth/signin?next=/library&locale=ko` lands on `/library` with the KO cookie |
| 6 | **Storage buckets + driver** (§5): buckets exist, driver shipped in M7, selected by `PLAYBOOK_MODE=cloud` | media | `npm run cloud:smoke` storage rows PASS; then a poster renders on `/en/prompts` and `/api/media/{a pro block}` answers 401 anonymously |
| 7 | **Stripe live keys** — secret, price, webhook endpoint + signing secret (§6) | payment | `isBillingConfigured()` true; the CTA is a checkout form, not the "not connected" panel |
| 8 | **Real test-mode checkout E2E** (§6 deferred gate) | payment | lock → pay `4242…` → same playbook unlocked → `/account` reads Active; then cancel in Stripe and confirm the blocks re-lock |
| 9 | **Resend domain + key + sender** (§7) | notifications | `npm run notify:worker` prints `mailer live (…)`; a test publish delivers one EN and one KO email |
| 10 | **Token secrets**: `MEDIA_TOKEN_SECRET` and `NOTIFY_TOKEN_SECRET` | media, unsubscribe | no `[media]` / `[notify]` "per-process random secret" warning in the deploy logs |
| 11 | **`NEXT_PUBLIC_APP_URL`** set to the real origin | sitemap, emails | `/robots.txt` and `/sitemap.xml` carry absolute URLs on the real domain, not `localhost` |
| 12 | **Deploy to Vercel** — env table + post-deploy checklist in §8 | — | `/en` and `/ko` render; `npm run sweep:anon` with `SWEEP_BASE_URL=https://…` passes |
| 13 | **Submit the sitemap** — Google Search Console, property on the real domain | indexing | `/sitemap.xml` fetched OK; the two showcase URLs appear, `/library` does not |
| 14 | **Launch content** (§9, `content/MANIFEST.md`) | launch, not engineering | six playbooks published; fixtures no longer visible in production |

Two things that are already true and do **not** need a step: the deletion runbook
(`docs/RUNBOOK-deletion.md`) and the notification worker code. Both are ready; only the credentials
above are missing.

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
npm run notify:worker -- --dry  # count pending notification deliveries (needs a durable DB, below)

# the M2 authz sweep — needs a server already running against the local snapshot.
# `build:local` / `start:local` FORCE PLAYBOOK_MODE=local, which is what keeps this offline on a
# machine whose .env.local carries live credentials (see §0).
npm run db:local; npm run build:local; npm run start:local   # in one shell
npm run sweep:anon                                           # in another (SWEEP_BASE_URL to point elsewhere)

# the M7 cloud smoke — read-only against the LIVE project, plus one staging probe it deletes
npm run cloud:smoke
```

**Port hygiene**: `npm start` leaves a detached `next-server` holding :3000 after the npm wrapper is
killed. Kill it by port, not by the npm process, or the next sweep silently runs against a stale
build (this is what produced M2's first false failure):

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

**Git Bash + curl gotcha (M4)**: MSYS rewrites any argument that looks like a POSIX path, so
`curl -F "_back=/admin/policy"` arrives at the server as `C:/Program Files/Git/admin/policy`. Probing
a form POST from Git Bash therefore needs `export MSYS_NO_PATHCONV=1` first, or the request is not
the request you wrote. (Discovered while verifying M4's server action; the app was fine, the probe
was not.)

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

## Render-verifying the admin CMS (M4)

`npm run dev:admin` maps the dev identity to the admin fixture profile (`is_admin = true`), so the
whole `/admin` surface is walkable locally. The editor is deliberately **JS-free** — every control
is a plain form posting to one guarded server action — so everything below works with scripts off.

```powershell
npm run db:local     # once — the snapshot carries a DRAFT fixture (insta-toon-pipeline)
npm run dev:admin    # then open http://localhost:3000/admin
```

**Director click-path** (the §8 M4 `[manual]` gate, author → publish without SQL):

1. `/admin` — the table lists all five fixtures. Check the columns: status, category, **Showcase**
   (live / next publish / off — `is_showcase` is revisioned, so it is two facts), **Draft revision**
   (only `insta-toon-pipeline` shows "rev 1 in progress"), updated. Press **Refresh caches**; the
   banner reads "Catalog caches refreshed" and pressing it again does the same thing.
2. **New playbook** — slug `test-drive`, category *Pipeline*, EN/KO titles → **Create**. You land in
   the editor for a fresh rev-1 draft.
3. **Metadata** — fill summary EN/KO, difficulty, tools/models (comma separated), est. time/cost,
   tick **Showcase revision** (read the disclosure note under it) → **Save**.
4. **Hero** — upload any PNG. It renders back immediately, through `/api/admin/media/{rev}:hero`,
   with its server-computed sha256 printed beside it.
5. **Steps** — add two steps, rename them, use **↑ / ↓** to swap and swap back. Then in each step
   use the kind picker: add one block of every kind (prompt, params, asset, note, link,
   workflow_file). The asset and workflow forms take a file; the note form renders an EN/KO
   markdown preview through the real in-repo renderer.
6. **Effective visibility** — the table shows `block | kind | default | override | effective`. Set
   an override in the table, press **Apply overrides**, watch the effective column move. Then go to
   `/admin/policy`, change `note` to `pro`, come back: blocks that INHERIT move, blocks with an
   override do not.
7. **Preview as** → *Visitor* / *Free* / *Pro*. Same components as the public detail page; the lock
   panels appear and disappear per tier and the media resolves (draft bytes come from the admin
   endpoint, never the public gateway).
8. **Publish** → the banner reads "Published, and the catalog cache was refreshed". Open
   `/en/p/test-drive` — it renders. Open `/library` — it is in the grid. Right-click an asset →
   the bytes come from `/api/media/{blockId}`.
9. **Republish** — press **Edit published playbook**: a rev-2 draft appears, cloned (new step and
   block ids, new staging keys, same hashes). Press **Publish** without touching the change note:
   the form says *"Republishing needs a change note in both languages."* Fill it in and publish.
10. **Archive** — back on `/admin`, archive `test-drive`; `/en/p/test-drive` now 404s. Restore it and
    it comes back.

Two things worth checking because they are security properties, not features:

- with the dev server running as `dev:admin`, `/api/media/{a draft block id}` still answers **404**
  (M2 ratification: the public gateway refuses draft/superseded media *for admins too*);
- with a plain `npm start` (no dev identity), `/admin*` 307s to sign-in and
  `/api/admin/media/*` answers **401**, both `private, no-store` + `noindex`.

### Media token secret

The media gateway signs its own ≤60s capability tokens (`lib/media/token.ts`). It uses
`MEDIA_TOKEN_SECRET` if set, falls back to `SUPABASE_SERVICE_ROLE_KEY`, and otherwise generates a
per-process random secret with a warning — fine for dev, but **set `MEDIA_TOKEN_SECRET` before
deploying** so tokens survive a restart and are not derived from an unrelated key.

## Local catalog data (no Supabase project required)

The landing and pricing pages read the catalog projection through `lib/content/public-catalog.ts`,
which resolves a `SqlRunner` in this order (`lib/db/connect.ts`):

1. `DATABASE_URL` → `pg` pool. The production path.
2. `PLAYBOOK_LOCAL_DB_DIR` → a DURABLE PGlite data directory (M5, opt-in — see below).
3. `.pglite/catalog.tar.gz` → an in-memory PGlite loaded from a dump. The dev path while §11's
   Supabase stop-gate is open.
4. none of the above → the empty catalog, and both pages render their designed empty states. CI
   builds exactly this way.

`npm run db:local` builds (3): a fresh PGlite, the real `*_core_*` migrations, and the real
prepare → copy → publish seed, dumped to `.pglite/catalog.tar.gz` (gitignored). A dump rather than
a live data directory so Next's parallel static-generation workers can each open their own
read-only copy without fighting over a file lock.

Re-run it whenever the migrations or `scripts/fixtures.ts` change. Fixture media lands under
`.storage/` via the local storage driver; nothing serves it over HTTP, so the cards render their
generated covers — see `docs/CONTENT-SLOTS.md`.

### A DURABLE local database (M5)

That snapshot is loaded **into memory**, so every write dies with the process. Fine for reading a
catalog; useless for a queue, because the notification worker is a second process that has to see
what `/admin` enqueued in the first. So `db:local` also builds option (2) — a real PGlite data
directory:

```powershell
npm run db:local -- --dir .pglite/dev     # same migrations, same seed, on disk this time
$env:PLAYBOOK_LOCAL_DB_DIR = ".pglite/dev"
```

`lib/db/connect.ts` prefers it over the snapshot when the variable is set, and falls back if the
directory cannot be opened. **One process at a time** — PGlite takes an exclusive lock on a data
directory, so stop `next dev` before running the worker against the same folder.

## Running the notification worker offline (M5)

The full §3.5 loop, with no Resend account and no Supabase project:

```powershell
npm run db:local -- --dir .pglite/dev             # 1. durable database + fixtures

$env:PLAYBOOK_LOCAL_DB_DIR = ".pglite/dev"
npm run dev:admin                                 # 2. author + publish WITH the notify checkbox
#    /admin → open a draft → Publish, ticking "Email subscribers about this publication"
#    then stop the server (PGlite holds the directory)

$env:PLAYBOOK_FAKE_MAILER = "1"                   # 3. the deterministic mailer (dev only)
npm run notify:worker
npm run notify:worker                             # 4. again: 0 expanded, 0 claimed, 0 sent
```

Three things worth knowing before you read the output:

- **`PLAYBOOK_FAKE_MAILER=1` is dead code in a production build**, exactly like
  `PLAYBOOK_FAKE_BILLING` — `next build` inlines `NODE_ENV === 'production'` and the branch is
  removed. A real `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` always wins over it.
- **No mailer at all changes nothing.** The worker prints `mailer NOT CONFIGURED`, claims nothing
  and exits 1. It will never mark a delivery `sent` that no provider accepted.
- **Nobody is subscribed by default.** `profiles.notif_*` default to `false` (§6), so the fixture
  users receive nothing until you turn the switches on — either in `/account` as `dev:pro`, or:

```sql
update profiles set notif_new_playbook = true, notif_updates = true
 where email = 'pro@playbook.test';
```
