# PLAYBOOK — Product Plan

> **Status**: v1.4 (final) — authored by Fable (Director), cross-validated with Codex `gpt-5.6-sol` over rounds R1–R3 plus closure checks R3b/R3c (log §12). Execution owner: Opus.
> **Codename**: PLAYBOOK (working title — naming gates M5 deploy only, §11).
> **Relationship to TWIIN**: complete new product. TWIIN's operating model (character OS, creator studios) is retired. Nothing from `apps/*` is reused; only infra know-how (Supabase, Stripe, deploy) carries over.
> **Date**: 2026-08-12

---

## 0. TL;DR

A bilingual (ko/en) content site that publishes **AI media production workflows as step-by-step playbooks** — the actual pipelines YAGI uses internally (character sheets, talking clips, LoRA training, insta-toons, voice identity...). Visitors see the landing; Google login opens the full library; every step is built from typed **blocks** (prompt, params, asset, note, workflow file) and each block carries an **admin-controlled visibility level**. Free users see the structure and selected assets; **Pro ($9/month)** unlocks every prompt/parameter and can turn on new-drop notifications. A right-hand **ad rail** ("YOUR AD HERE" placeholder) follows the scroll on landing and inside the service. Design and interaction sensibility is borrowed from **yagiworkshop.xyz** (measured, §5): black/white inversion, hyperlink-blue accent, giant condensed typography, sticky-scene scroll storytelling, circular section wipes.

---

## 1. Product definition & positioning

**One-liner**: *The open production floor of an AI studio.* We publish how AI media is actually made — model by model, prompt by prompt, step by step.

**Why this product**
- Supply is already built: YAGI's internal pipelines are the content. Publishing them costs curation, not invention.
- The "how do I actually make this?" market is underserved: scattered Twitter threads, stale YouTube tutorials, no structured + maintained + bilingual source.
- Every playbook doubles as a capability proof → inbound B2B leads for the studio (a lightweight "Work with the studio" CTA exists from v1, §3.1), and the ad rail is a third revenue slot.

**What it is NOT**
- Not a generation tool. We never run inference for users in v1. No GPU cost, no abuse surface.
- Not a community/UGC platform in v1. Admin-authored only.
- Not a course platform. Playbooks are living reference documents, updated when models change — that's the retention hook ("this workflow still works today").

**Audience**: solo creators, marketing teams, small studios producing AI media in KO/EN markets. Secondary: brands evaluating AI production (lead-gen).

---

## 2. Users & core journeys

| Role | Entry | Can see | Cannot see |
|---|---|---|---|
| **Visitor** (logged out) | Landing + showcase playbooks (SEO) | Landing, pricing, all published playbooks' **card metadata** (title/summary/category/difficulty/hero), `public` blocks on showcase pages | Library browsing, non-showcase content, `free`/`pro` blocks |
| **Free user** (Google login) | Full library | All published playbooks' structure, steps, `public`+`free` blocks (selected assets, notes, output previews) | `pro` blocks (prompts, params, workflow files), notifications |
| **Pro user** ($9/mo) | Everything | All blocks incl. prompts/params/workflow downloads, copy buttons, notification toggles | `hidden`/`admin` blocks |
| **Admin** (`is_admin`, @yagiworkshop.xyz allowlist) | `/admin` | Everything + CMS + visibility matrix + publish + users | — |

**Journey A (conversion path)**: lands on `/ko` → scroll story sells the premise → opens a showcase playbook → hits a locked prompt block mid-step ("the recipe stops where the value starts") → Google login (1 click) → still locked, sees exactly *how many* blocks Pro unlocks across the library → $9 checkout → returns to the same playbook, server reconciles the Checkout session, block is unlocked (§3.4).

**Journey B (retention path)**: Pro user toggles notifications on (M5+) → new playbook drops or an existing one gets a "model updated" revision → email → returns.

**Journey C (admin)**: author draft revision in `/admin` → per-block visibility from matrix defaults, overridden where needed → preview as visitor/free/pro → publish via the `publish_revision` RPC (atomic swap) → (M5+) notification fan-out.

---

## 3. Feature spec

### 3.1 Landing (`/[locale]`, public)
- Full-bleed scroll-story page in the yagiworkshop.xyz register (§5). Sections: **Hero** (giant type + reel video) → **Premise** ("we publish our production floor") → **How it reads** (3 pinned panels: Steps → Blocks → Unlock) → **Featured playbooks** → **Pricing** (Free vs Pro table) → **FAQ** → **Footer**.
- **Featured selection (deterministic)**: the latest 4–6 *published* playbooks with hero media, newest first, labeled "LATEST". No manual flag in v1. Cards for non-showcase playbooks link into the login wall (intended funnel).
- **Public metadata rule**: card metadata (title, summary, category, difficulty, hero) of every *published* playbook is publicly displayable — it is marketing surface. Full content requires login; block content follows §3.4 gating. Admin UI states this rule where heroes are uploaded.
- Landing and pricing are **static with tag-based revalidation + TTL floor**: catalog-derived data is cached under tag `catalog`; the publish flow triggers `revalidateTag('catalog')`, and pages also carry `revalidate = 3600` so a lost invalidation self-heals within an hour. An idempotent "Refresh caches" button exists in `/admin` (§3.8).
- Locale toggle `EN | KO` in the nav (§3.9). CTA: `Google로 시작하기` / `Start with Google`.
- Footer carries the B2B lead CTA: "Work with the studio →" (mailto + `hire_click` event). The same strip appears at the bottom of playbook detail pages.
- Ad rail on ≥1440px viewports, starting below the hero (§3.6).
- SEO: landing + pricing + showcase playbooks are the public surface (§3.9 routing/hreflang). Library/app pages are `noindex` behind auth.

### 3.2 Library (`/library`, login required)
- Grid of playbook cards: hero media (hover autoplay muted), title, category chip, difficulty, tools/models used, "N pro blocks" indicator, NEW/UPDATED badges.
- Filters: category (image / video / character / voice / music / pipeline), difficulty, tool/model tag. Sort: **newest only in v1**. Search: server-rendered query over title+summary.
- Empty/loading states: skeletons (no spinners).

### 3.3 Playbook detail (`/[locale]/p/[slug]`)
- **Header**: hero preview (video/image), title, summary, meta strip (est. time, est. cost, models, tools), updated-at + change note ("2026-08: swapped to Seedance 2.0").
- **Step timeline**: vertical numbered steps (sticky step index on the left at ≥1024px; horizontal chip bar below). Each step = title + body + ordered **blocks** (content contracts in §6.1):
  - `prompt` — monospace block, copy button (Pro), locked render for non-Pro
  - `params` — key/value table (model, CFG, steps, LoRA weights...)
  - `asset` — image/video with caption (usually `free`)
  - `note` — tips/warnings markdown
  - `link` — external tool/model reference
  - `workflow_file` — downloadable artifact (ComfyUI graph JSON, LUT, preset) — Pro
- **Locked block render**: block chrome + kind label visible, content replaced by lock panel: "🔒 Prompt — unlock with Pro". *No teaser text, no blurred real content* (blur is reversible; never ship gated bytes to the client). The shaper also strips storage keys/URLs of gated media (§7).
- **Media gateway** (`/api/media/:blockId`) authorizes the **full chain** before serving: block → step → revision must equal the playbook's **current `published_revision_id`** (drafts/superseded/archived refuse) → playbook eligibility for the viewer (anon ⇒ current published revision has `is_showcase`; free/pro ⇒ published) → effective visibility ≤ viewer tier. Then redirects to a ≤60s signed URL against the **published private copy** (§6 asset lifecycle). Public-bucket URLs are only ever emitted for current showcase revisions and heroes.
- Bottom of page: next/prev playbook, inline Pro CTA if any block was locked, "Work with the studio" strip.

### 3.4 Gating & payments
- **Plan**: Pro, **$9/month** (Stripe subscription; `price_pro_monthly`). Cancel anytime via Stripe customer portal. Annual/one-time out of v1 (stop-gate at M3, §11).
- **Entitlement definition (single source of truth)**: Pro iff `subscriptions.status IN ('active','past_due')`. Stripe owns the retry window; `canceled` ends entitlement; `cancel_at_period_end` keeps `active` until period close. `profiles.plan` is a display mirror updated in the same write; the shaper derives from `subscriptions`.
- **One reconciliation path, race-safe by fencing**: `reconcileSubscription(userId)`:
  1. Fetch **current truth** from the Stripe API (subscription by customer; never trust event payloads as state). Record fetch timestamp `t`.
  2. Single atomic **upsert** of `subscriptions` (+ `profiles.plan` mirror in the same transaction), guarded by a fence: write applies only if `stripe_fetched_at IS NULL OR stripe_fetched_at < t`. Interleaved reconciles converge on the newest fetch; no row lock needed, missing rows are created by the upsert.
  - Callers: `/billing/success` (with session id), every webhook (webhooks are *triggers only*), admin manual action.
  - **Duplicate-subscription policy**: checkout creation is server-guarded (already-entitled users get the portal, not a new checkout). If Stripe ever reports two subs for one customer, keep the newest and cancel the older (admin runbook step; logged).
- **Checkout flow**: Stripe Checkout (hosted), origin slug + locale in metadata → `/billing/success` reconciles → redirect to origin unlocked; bounded "confirming payment…" state. `/billing/cancelled` returns unchanged.
- **Webhooks** (`/api/stripe/webhook`, signature-verified): `checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed`. Ledger semantics: insert event id (PK) with `processed_at = NULL`; an event is skipped **only if it exists with `processed_at NOT NULL`**; handler runs reconcile then stamps `processed_at` — failed handlers leave `NULL` and a retry sweep reprocesses them.
- **Enforcement is server-side only**: gated content is fetched with the service role inside RSC/route handlers and shaped per a **server-verified session** (§7). The browser's Supabase client is auth-only — zero client-side data queries; RLS deny-all (§6).
- **Cache contract**: every viewer-shaped page/handler (`/[locale]/p/*`, `/library`, `/account`, `/billing/*`, `/api/media/*`) is `force-dynamic` + `Cache-Control: private, no-store`. Static + tagged/TTL revalidation only for landing/pricing. Acceptance includes the Pro→free→anon same-slug sequence test (§8 M2).
- Pricing page counts ("N prompts across M playbooks") come from the cached public catalog projection.

### 3.5 Notifications (Pro; **delivery ships in M5 — zero notification UI before that**)
- Toggles on `/account` (M5+): **New playbook**, **Playbook updates**. Weekly digest deferred to v1.1. Until M5, the publish RPC is called with `p_notify_kind = NULL` (enforced by a server flag) and no checkbox exists in admin.
- Channel: email via Resend (React Email, bilingual by `profiles.locale`). Web push deferred.
- **Durable outbox with exactly-once posture**: publish RPC inserts `notification_jobs` in the publish transaction, unique `(revision_id, kind)`. **Worker**: a scheduled Edge Function (cron, every minute) expands new jobs into `notification_deliveries` (PK `(job_id, user_id)`), then claims pending deliveries in batches via `FOR UPDATE SKIP LOCKED` (status `pending→sending` + `claimed_at`); sends with Resend idempotency key `job_id:user_id`; marks `sent`/`failed` (attempts ≤3, backoff); a recovery sweep returns `sending` rows with `claimed_at` older than 10 min to `pending`. Preference AND Pro entitlement are checked **at claim time**.
- Every email carries a one-click unsubscribe link (signed token flips the toggle).
- In-app: NEW/UPDATED badges for everyone (badges are marketing for the toggle).

### 3.6 Ad rail
- **Right rail** on: landing below the hero, `/library`, `/[locale]/p/[slug]`. Visible **≥1440px only** (§4 layout math). Below 1440: one inline banner slot (landing: between sections; detail: after step 2). Never more than one ad per viewport.
- **Lagged follow** (user-stated requirement, kept by design): fixed-position element in a root-level portal (never inside transformed/pinned ancestors), positioned via JS spring interpolation (~0.08 lerp) off the Lenis scroll value — trails the scroll, then settles. `prefers-reduced-motion`: plain `position: sticky`.
- **Landing coexistence rule**: below the hero at ≥1440, sections keep interactive/text-critical content out of the right 340px band (content column 1000px, §4); full-bleed decorative strips (marquee, wipe) may pass beneath the rail.
- v1 renders a single house placeholder: bordered card, `YOUR AD HERE` in Big Shoulders 900, blue `advertise@yagiworkshop.xyz` link. 300×max-600px.
- Implementation: `<AdRail slot="..." />` reading a static config module (DB-backed `ad_slots` deferred until a real advertiser exists).

### 3.7 Accounts & auth
- **Users**: Google OAuth only (Supabase Auth). First login creates `profiles` (locale from active UI locale). OAuth round-trips carry `{origin, locale}` as `redirectTo` query params (M0 ratification: Supabase owns the `state` param opaquely), so the return trip lands on the originating page in the right language (§3.9).
- **Admins**: same Google auth + `profiles.is_admin` (seeded manually; `@yagiworkshop.xyz` allowlist pattern). Gate split (M0 ratification, forced by deny-all RLS): middleware gates *session presence* for `/admin/*` + `/library` at the edge; the `(admin)` root layout verifies `is_admin` with the service role and returns **404** (not 403) to non-admins. `is_admin`/`plan` are not self-updatable (deny-all RLS + server actions).
- `/account`: plan status, Stripe portal link, notification toggles (M5+), locale preference, sign out.
- **Account deletion (v1 = honest request flow)**: "Request deletion" opens a prefilled request. Runbook ships with M5: cancel Stripe subscription → delete auth user + profile (cascade) → anonymize `events.user_id` → confirm within 7 days. Self-serve deletion post-launch.

### 3.8 Admin CMS (`/admin`)
- **Revision model (core)**: published content is immutable **at the database level** (§6 triggers + composite FK). Editing a published playbook clones it into a draft revision; steps/blocks belong to the revision. **Publish = one `publish_revision` RPC** (§6). Draft/archived content is reachable only through the authorized admin preview path.
- **v1 editor (deliberately minimal)**:
  - Playbook list: status, updated, has-draft-revision indicator. "Refresh caches" button (idempotent `revalidateTag('catalog')`).
  - Metadata form (dual-locale side by side) + step list with **up/down ordering** (drag-and-drop deferred) + per-step block CRUD with **type-specific forms** per §6.1 contracts.
  - Uploads go to private revision-scoped staging keys with intended visibility tagged (§6 asset lifecycle).
  - **Visibility control = effective-visibility table** per revision: `block | kind | default | override | effective`, inline override editing. This is the "admin controls exactly which columns are exposed" surface.
  - Preview-as: render any revision as visitor/free/pro via the same shaping path with an admin-verified `previewTier`.
  - Publish button → RPC. Republishing an already-published playbook **requires a change note** (regardless of notification). Notification checkbox exists only from M5.
- `/admin/policy`: global defaults per kind (`asset→free`, `note→free`, `prompt→pro`, `params→pro`, `workflow_file→pro`, `link→public`). **Non-retroactive**: effective visibility stamped at publish (`resolved_visibility`); republish to apply new policy.
- **Deferred from v1**: users tab (Supabase dashboard suffices), CSV export, drag-and-drop, matrix heat view, Claude-assisted translation.
- All jsonb payloads validated with zod (§6.1 schemas) at the server boundary; the RPC re-validates at publish.

### 3.9 i18n (ko/en)
- **Public pages are locale-prefixed, including playbook details**: `/[locale]`, `/[locale]/pricing`, `/[locale]/p/[slug]`. Unprefixed public URLs 308-redirect to the resolved locale. Every public page emits **self-canonical + hreflang alternates (en/ko + x-default)**. App pages (`/library`, `/account`, `/billing/*`, `/admin/*`) are unprefixed + `noindex`; locale from the preference chain.
- **Locale precedence (one rule everywhere)**: `URL prefix > explicit cookie > profile.locale > Accept-Language > 'en'`. The toggle writes cookie + profile (when logged in) atomically and navigates to the equivalent URL. OAuth round-trips preserve `{origin, locale}` via `state`.
- **UI strings**: dictionary modules (`messages/en.ts`, `messages/ko.ts`).
- **Content**: localized text fields are `jsonb {en, ko}` per §6.1. **Publish gate**: both locales required on title, summary, step titles, step bodies *where present* (a step may be blocks-only), asset captions *where present*, link labels, and change notes. Fallback render (other locale + "EN" tag) exists only for rare post-publish edge cases.
- **Prompts are NOT translated** (model inputs; usually English). A `note` block carries the KO explanation. Params/labels localized at the UI layer.
- Admin editor shows en/ko side-by-side; manual bilingual authoring in v1.

---

## 4. IA & layout

```
/[locale]                     landing                      [static + tag 'catalog' + revalidate 3600]
/[locale]/pricing             pricing                      [static + tag 'catalog' + revalidate 3600]
/[locale]/p/[slug]            playbook detail              [dynamic, private no-store; public iff showcase+published]
/library                      library grid (login)         [dynamic, no-store, noindex]
/account                      account (login)              [dynamic, no-store, noindex]
/billing/success|cancelled    checkout returns             [dynamic, no-store, noindex]
/billing/upgrade              tier-aware upgrade page (M3: static pricing tree cannot branch on tier)  [dynamic, no-store, noindex]
/api/billing/checkout|portal  checkout/portal session creation (server-guarded)  [dynamic, no-store]
/api/events                   funnel beacon (type whitelist, fire-and-forget)    [dynamic, no-store]
/admin/...                    CMS (admin only)             [dynamic, no-store, noindex]
/api/media/[blockId]          entitlement-checked media/file gateway
/api/stripe/webhook           Stripe events
```

**Layout math (verified; container 1440, gutters `clamp(24px, 3vw, 64px)` → inner ≤1360)**
- **≥1440 (rail tier)**: Library `[minmax(0,1000) | 40 | 300]` = 1340 ✓ (cards 2-col). Detail `[220 | 40 | minmax(0,720) | 40 | 300]` = 1320 ✓. Landing below hero: content 1000 + rail 300 = 1340 ✓; hero + decorative strips full-bleed (band rule §3.6).
- **1024–1439 (no rail; inline banner)**: Library full-width content, cards 2-col ≥1180 else 1-col. Detail `[220 | 40 | minmax(0,720)]` = 980 ✓.
- **768–1023**: single column; step index → sticky horizontal chip bar; pins disabled (§5.4).
- **375–767**: single column, `svh` hero, no pins/scrubs/wipes, inline banner only.

**Nav (public + app)**: fixed top bar, 64px. **Theme is section-state-driven** (IntersectionObserver flips `data-theme="light|dark"` — no `mix-blend-mode` dependence). Solid hairline underline on scroll. Contents: logo (goat mark) · Library · Pricing · `EN|KO` · Sign in / avatar. Overlay menu <768.

**Admin**: dense utilitarian layout, left nav + table/editor; no ad rail, no scroll theatrics.

---

## 5. Design direction — "borrowed sensibility" spec

Measured from yagiworkshop.xyz (2026-08-12, DOM extraction). We borrow the **sensibility**, rebuilt in code (site is Framer; we implement with GSAP + ScrollTrigger + Lenis).

### 5.1 Palette
```css
--black: #000000;      /* section bg — pure, not #0a0a0a; the site is hard black/white */
--white: #FFFFFF;
--blue:  #0000EE;      /* the classic hyperlink blue, used deliberately as the only accent */
--gray-line: rgba(0,0,0,.12) / rgba(255,255,255,.16);  /* hairlines per bg */
```
- **Two inks + one accent**; media supplies all other color. No gradients, no glassmorphism, no colored shadows (YAGI anti-slop rules).
- **M1 ratification**: `#0000EE` measures 2.23:1 on pure black (fails WCAG AA). Dark surfaces use `--accent: #4C6FFF` (same hue family, 5.03:1); `#0000EE` stays the accent on white (9.40:1). One accent per surface, two tokens.
- Section rhythm: hard black↔white inversions; the inversion IS the visual identity.

### 5.2 Typography
| Role | EN | KO | Notes |
|---|---|---|---|
| Display | **Big Shoulders** 700/900, uppercase, leading 0.9 | **Pretendard** 900, tracking -1~-2% | site: 108px hero / 200px titles; ours: clamp(64px→180px); KO display ~0.85× EN |
| Label / eyebrow | **Anton SC** 400, uppercase, 12–14px, ls 0.12em | Pretendard 700 | section numbers, chips |
| Body | **Satoshi** 400/500 | **Pretendard** 400/500 | 16px/1.6 |
| Mono (prompts/params) | **Geist Mono** | same | prompt blocks, param tables |

**Font ops (locked at M0)**: self-host all faces as WOFF2 (no runtime CDN) — Big Shoulders (OFL), Anton SC (OFL), Satoshi (Fontshare ITF-FFL — license file in repo), Pretendard (OFL, official dynamic subset for KR), Geist Mono (OFL); licenses under `public/fonts/LICENSES/`. Subset display faces to latin; preload display-900 + body-400 only; `font-display: swap` + fallback metric overrides (`size-adjust`) for zero CLS; `:lang(en)`/`:lang(ko)` stacks (KO display never falls back to Big Shoulders — no Hangul coverage). Weight extremes only (400 vs 900); size jumps ≥3×; no Inter. Display lines manually broken: "MAKE / WHAT ISN'T / REAL." style.

### 5.3 Interaction inventory (the "감각" to reproduce)
1. **Sticky scenes** — full-viewport pinned sections, scroll-scrubbed internals (landing "How it reads", 3 panels). **≥1024 only.**
2. **Circular wipe** — circle scales to flip black↔white between inverse sections. Once or twice max. ≥1024; fade below.
3. **Text-swap hover** — labels rendered twice, stack slides on hover. All primary CTAs + nav links.
4. **Giant type reveal** — clip-path mask reveal, 80ms stagger; section titles scrub ±40px.
5. **Marquee strip** — tools ticker ("KLING · VEO · COMFYUI · ELEVENLABS..."), 40s loop, pause on hover.
6. **Card hover** — media zoom 1.03 + lift −2px, 300ms; no text scaling.
7. **Ad rail lagged follow** — §3.6.
8. **Pinned hero media** — reel scales 1.05→1.0 + parallax on first scroll (desktop; plain autoplay mobile).
- Motion budget: landing is the theater; library/detail/admin get calm motion (reveals ≤400ms, hovers, rail). Reduced-motion: scrubs→fades, rail→sticky, pins off.

### 5.4 Motion stack & ownership contract
- **Lenis in native-scroll mode** (no wrapper transform) — `sticky`/`fixed` stay valid. **ScrollTrigger owns pins**, landing only, wired to Lenis via scrollerProxy in the M0 motion shell.
- **Containment**: pinned sections contain no sticky descendants and never the rail; rail = root-level portal (fixed + JS transform); detail sticky index has no transformed ancestors.
- **<1024**: no pins/wipes/scrubs; normal flow + `svh`; hero video `autoplay muted playsinline`.
- **HyperFrames** (CLI v0.7.106, installed 2026-08-12): renders hero reel + playbook preview videos offline → static MP4/WebM assets. Videos are assets, not runtime dependencies.
- **Remotion**: NOT in v1.

### 5.5 Locked-block visual
Locked blocks keep full chrome (kind label, frame) + flat panel: blue lock glyph, "Unlock every prompt — $9/mo", text-swap hover CTA. Part of the design system, not an error state. Lock counts surface in the step index ("Step 3 · 2 locked").

---

## 6. Domain model

```sql
create table profiles (
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

create type visibility as enum ('public','free','pro','hidden');
-- ordering: public < free < pro < hidden(admin-only)

create table playbooks (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  category text not null check (category in ('image','video','character','voice','music','pipeline')),
  sort int not null default 0,
  published_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table playbook_revisions (
  id uuid primary key default gen_random_uuid(),
  playbook_id uuid not null references playbooks on delete cascade,
  rev_no int not null,
  state text not null default 'draft' check (state in ('draft','published','superseded')),
  is_showcase boolean not null default false,  -- revisioned (R3b): public SEO eligibility + asset routing take effect on publish, never live-flipped
  title jsonb not null,
  summary jsonb not null,
  difficulty text not null default 'intermediate' check (difficulty in ('beginner','intermediate','advanced')),
  tools text[] not null default '{}',
  models text[] not null default '{}',
  est_time_min int check (est_time_min is null or est_time_min > 0),
  est_cost_usd numeric(8,2) check (est_cost_usd is null or est_cost_usd >= 0),
  hero_asset jsonb,              -- AssetRef (§6.1); heroes are always public-published (§ asset lifecycle)
  change_note jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (playbook_id, rev_no),
  unique (playbook_id, id)       -- enables the same-playbook composite FK below
);

-- Same-playbook pointer enforced STRUCTURALLY (no trigger needed for this):
alter table playbooks add constraint fk_published_revision_same_playbook
  foreign key (id, published_revision_id)
  references playbook_revisions (playbook_id, id);

create table steps (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references playbook_revisions on delete cascade,
  "order" int not null,
  title jsonb not null,
  body jsonb,                    -- nullable: a step may be blocks-only; locale gate applies where present
  unique (revision_id, "order")
);

create table blocks (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references steps on delete cascade,
  "order" int not null,
  kind text not null check (kind in ('prompt','params','asset','note','link','workflow_file')),
  content jsonb not null,        -- discriminated per kind (§6.1); minimal per-kind CHECKs + zod at boundary + RPC revalidation
  visibility visibility,         -- author override; NULL = inherit default_policy(kind)
  resolved_visibility visibility,-- stamped by publish RPC
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

create table default_policy (
  kind text primary key,
  visibility visibility not null
);

create table publish_assets (    -- publish manifest (R3b): routing derived from stamped visibility, recorded in DB
  revision_id uuid not null references playbook_revisions on delete cascade,
  ref text not null,             -- block id or 'hero'
  sha256 text not null,
  source_staging_key text not null,
  target_bucket text not null check (target_bucket in ('public-content','content-published','artifacts-published')),
  target_key text not null,      -- {sha256}.{ext}
  copied_at timestamptz,
  primary key (revision_id, ref)
);

create table subscriptions (
  user_id uuid primary key references profiles on delete cascade,
  stripe_subscription_id text unique not null,
  status text not null,          -- Stripe status verbatim; entitled iff IN ('active','past_due')
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  stripe_fetched_at timestamptz not null,  -- fetch-time fence: upserts apply only with a newer fetch
  updated_at timestamptz not null default now()
);

create table stripe_events (
  id text primary key,           -- Stripe event id; skip only if processed_at NOT NULL
  type text not null,
  created timestamptz not null,
  payload jsonb not null,
  processed_at timestamptz       -- NULL = pending/failed → retry sweep reprocesses
);

create table notification_jobs (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references playbook_revisions,
  kind text not null check (kind in ('new_playbook','playbook_update')),
  created_at timestamptz not null default now(),
  unique (revision_id, kind)
);

create table notification_deliveries (
  job_id uuid not null references notification_jobs on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts int not null default 0,
  claimed_at timestamptz,        -- lease; recovery sweep: sending + claimed_at < now()-10min → pending
  sent_at timestamptz,
  primary key (job_id, user_id)
);

create table events (
  id bigint generated always as identity primary key,
  user_id uuid,
  type text not null check (type in ('view_playbook','hit_lock','start_checkout','unlock_success','hire_click')),
  playbook_id uuid,
  meta jsonb,
  created_at timestamptz not null default now()
);
-- updated_at maintained by a shared trigger on profiles/playbooks/subscriptions.
```

### 6.1 Block content contracts (discriminated; zod source of truth, mirrored here)

```ts
type Localized = { en: string; ko: string };          // publish gate enforces both where the field is present
type AssetRef  = {
  staging_key: string;            // content/rev/{revision_id}/{uuid}.{ext} (private)
  sha256: string;                 // recorded at upload — required (M0 ratification: prepare cannot build the manifest without it)
  published_key?: string;         // stamped at publish: {sha256}.{ext} in the serving bucket (§ asset lifecycle)
  bucket?: 'public-content' | 'content-published' | 'artifacts-published';
  mime: string; w?: number; h?: number; duration_s?: number;
};

prompt        = { text: string; model?: string; negative?: string }          // no i18n by design
params        = { rows: Array<{ k: string; v: string }> }                    // no i18n
asset         = { asset: AssetRef; caption?: Localized }
note          = { md: Localized }                                            // markdown
link          = { url: string; label: Localized }
workflow_file = { asset: AssetRef; filename: string; size_bytes: number; format: string }
hero_asset    = AssetRef                                                     // on playbook_revisions
```
These schemas define the M4 form fields and the M2 renderer props verbatim — the executor invents nothing.

**Publication is a two-phase database operation (R3b final shape)**

*Phase A — `prepare_publish(p_revision_id)`* (`SECURITY DEFINER`, admin-verified caller, re-runnable, one transaction):
  1. Requires `state='draft'`.
  2. **Stamps `resolved_visibility = coalesce(visibility, default_policy[kind])`** on every block — stamping happens at prepare, so routing below is always derived from already-stamped values, and preview-after-prepare shows exactly what will ship.
  3. **Rewrites the `publish_assets` manifest** for the revision: one row per referenced asset (every block AssetRef + hero + workflow files, all visibilities) with sha256 (recorded at upload), source staging key, and target routing derived in the same transaction from stamped visibility + the revision's `is_showcase`:
     - hero → `public-content` (heroes are always public marketing surface, §3.1)
     - `public` blocks → `public-content` **iff `revision.is_showcase`**, else `content-published` (private; "public" then means lowest gate behind login)
     - `free`/`pro`/`hidden` blocks → `content-published` (private) · workflow files → `artifacts-published` (private)

*Phase B — copier* (server code, idempotent): for each manifest row without `copied_at`, storage-copy staging → `{target_bucket}/{sha256}.{ext}` with **`upsert: false`** (existing identical key = success), then set `copied_at`.

*Phase C — `publish_revision(p_playbook_id, p_revision_id, p_notify_kind)`* (`SECURITY DEFINER`, admin-verified caller, one transaction):
  1. Validates: composite ownership (structural FK also guards it); `state='draft'`; locale-completeness per §3.9; change note present when the playbook was previously published; **manifest complete** (every row `copied_at`) and **manifest still current** — the RPC recomputes routing from the stamped values and errors on any mismatch (an edit after prepare forces a re-prepare; no stale routing can publish).
  2. Stamps `published_key`/`bucket` into each `AssetRef` from the manifest.
  3. Transitions: previous published revision → `superseded`; this revision → `published` + `published_at`; `playbooks.published_revision_id` swap; `playbooks.status='published'`.
  4. Inserts `notification_jobs` iff `p_notify_kind` is non-null (M5+; server flag forces NULL before that).

**Trigger enforcement with a non-spoofable privileged channel**: both RPCs are owned by a dedicated `publisher` role (granted to no app role; clients get only EXECUTE). Constraint triggers on `playbook_revisions`/`steps`/`blocks` reject **INSERT, UPDATE, and DELETE** when the owning revision's `state <> 'draft'`, and reject `state` transitions, `resolved_visibility` stamping, and `playbooks.published_revision_id` changes unless `current_user = 'publisher'` — true only inside the SECURITY DEFINER RPCs, unforgeable from app code (no GUC involved). Allowed transitions: `draft→published`, `published→superseded`; nothing (including raw service-role code) can insert content under a published revision, revert to draft, or mutate published rows outside the RPCs.

**Write-once serving & storage posture**: storage RLS is deny-all for client roles (consistent with the table posture); the copier writes with `upsert: false`; v1 ships **no delete code path** for published objects (GC of unreferenced keys is a post-launch task with reference checks); content-hash keys make overwrites structurally inert (same bytes → same key). Serving never touches staging.

- After Phase C commits, the server triggers `revalidateTag('catalog')` (TTL floor + admin refresh cover a lost call, §3.1).
- `is_showcase` lives **on the revision**: changing it means editing a draft and republishing — public eligibility and asset routing can never flip live (R3b).
- **Disclosure doctrine**: anything ever served from `public-content` is permanently disclosed (CDN copies). Tightening later stops serving, not disclosure; the admin UI states this.

**Security posture (deny-all)**
- The browser's Supabase client performs **auth only**; zero client-side data queries. RLS **enabled and forced on every table with no policies** (deny-all for `anon`/`authenticated`).
- Admin mutations run in server actions that verify `is_admin` from the server-verified session before using the service role. `plan`/`is_admin` never accept client-supplied values.

---

## 7. Architecture

- **App**: Next.js 15 (App Router, RSC) + TypeScript strict + Tailwind v4. Route groups `(marketing)`/`(app)`/`(admin)`, one deploy. **Versions of `next`, `@supabase/ssr`, `@supabase/supabase-js`, `tailwindcss`, `gsap`, `lenis`, `stripe`, `resend`, `zod` pinned at M0** against current documented contracts (async `cookies()`, Supabase SSR patterns, Tailwind v4 CSS-first tokens).
- **New repo**: `D:\dev\playbook` (locked default, §11).
- **Two Supabase client factories, strictly separated**: `lib/supabase/auth-client.ts` (cookie-bound anon key; `getUser()` verified against the auth server; middleware session refresh per @supabase/ssr) and `lib/supabase/data-client.ts` (service role, `server-only` import guard).
- **Server shaping — the one gate** (`lib/content/`):
  - Façade `getShapedPlaybook(slug, opts?)`: resolves session internally → tier `anon|free|pro|admin` → eligibility (anon ⇒ current published revision has `is_showcase`; free/pro ⇒ `published`; else 404 for non-admins) → loads the **current published revision** → shapes. Admin preview: `{revisionId, previewTier}` honored only after `is_admin` verification.
  - Internal pure `shapeRevision(revisionData, tier)`: every block arrives with a **non-null effective visibility** — published revisions use the stamped `resolved_visibility`; for draft previews the façade normalizes via the same shared resolver (`coalesce(override, default_policy)`) against current policy, labeled in admin as "preview approximates current policy; prepare/publish stamps it" (R3b). Compares effective visibility vs tier → `{content}` or `{locked: true, kind}`; strips staging/published keys of gated media. Pure; exhaustively unit-tested (§8 M2).
- **Catalog projections (two, not one)**:
  - `getPublicCatalog()` — showcase-safe card fields only (slug, title, summary, category, difficulty, public hero URL, lock counts, totals). Cached: tag `catalog` + `revalidate 3600`. Serves landing featured cards + pricing counts.
  - Library grid query — authenticated, full published list, dynamic (no-store), server-rendered.
- **Payments**: Stripe Checkout + portal; `reconcileSubscription` with fetch-time fencing (§3.4); webhook route feeds the ledger then reconciles; retry sweep for unprocessed events.
- **Email**: Resend + React Email, bilingual, idempotency keys, unsubscribe tokens; cron worker per §3.5.
- **Cache contract**: §3.4/§4 route table.
- **Deploy**: Vercel + Supabase. Edge middleware: session refresh, auth gates, locale redirects.
- **Analytics**: `events` (5 types) + Vercel Analytics. No third-party trackers.
- **Testing**: Vitest — pure `shapeRevision` truth table (4 tiers × 4 visibilities = 16 + strip assertions), façade eligibility matrix (tier × playbook.status{draft,published,archived} × showcase), publish RPC guards + trigger enforcement (pg test db), reconcile fencing races, webhook ledger retry semantics. Playwright — login→lock→checkout(test)→unlock; authz sweep (no gated bytes/keys in HTML/Flight for anon/free); Pro→free→anon same-slug sequence; REST deny probes; signed-URL expiry; media-gateway refusal for superseded/draft revision block ids.
- **Env**: `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `STRIPE_SECRET_KEY/WEBHOOK_SECRET/PRICE_PRO`, `RESEND_API_KEY`, `APP_URL`.

---

## 8. Milestones (execution plan for Opus)

Gates labeled **[auto]** (CI) or **[manual]** (stated procedure). Each milestone = PR on a feature branch; Director verifies `git rev-parse HEAD` + test runs before merge (TWIIN hard rules carry over).

| M | Scope | Acceptance |
|---|---|---|
| **M0 Foundation** | New repo; pinned deps; tokens + font pipeline (§5.2); Lenis+GSAP motion shell; Supabase project + **full §6 migrations incl. `prepare_publish` + `publish_revision` RPCs, `publisher` role, triggers, composite FK, manifest table**; Google OAuth; locale routing + precedence; **seed script publishes 2 fixture playbooks through the real prepare→copy→publish flow** (every block kind × visibility); entitlement fixtures (anon/free/pro/admin test users via `subscriptions` rows) | [auto] migrations on fresh DB; REST probes deny on every table; RPC guard tests (cross-playbook FK, locale gate, non-draft INSERT/UPDATE/DELETE rejection on steps+blocks, direct service-role state/pointer/stamp writes rejected via publisher-role gate); seeds visible via façade. [manual] Google OAuth round-trip; KO+EN font rendering per §5.2 stacks |
| **M1 Landing + pricing** | Full landing per §5 (hero, pinned panels ≥1024, circle wipe, marquee, featured cards from `getPublicCatalog()`, FAQ, footer + hire CTA), pricing page, ad rail (≥1440, lagged follow, reduced-motion sticky), EN/KO toggle, static+tag+TTL caching | [auto] LHCI desktop preset, median of 3, perf ≥90 on `/en`; cache headers per §4 route table; hreflang/canonical reciprocal. [manual] motion contract at 1440/1280/1024/768/375 incl. reduced-motion |
| **M2 Content core** | Library grid + filters + search; detail page + step timeline + 6 block renderers per §6.1; `getShapedPlaybook`/`shapeRevision`; locked-block UI; media gateway with full-chain authorization (§3.3) | [auto] pure truth table 16/16 + strip assertions; façade eligibility matrix (tier × status × showcase); Playwright authz sweep: zero gated bytes or storage keys for anon/free; Pro→free→anon sequence clean; gateway refuses draft/superseded block ids; signed URL rejected after expiry; edit-after-prepare manifest mismatch blocks publish |
| **M3 Monetize** | Stripe Checkout + `/billing/success` reconciliation + webhook ledger + retry sweep + portal; fencing upsert; account page (no notification toggles yet); funnel events | [auto] E2E test-mode lock→pay→unlock without webhook delivery; replay + out-of-order webhook after success-reconcile → no state regression (fencing test); unprocessed-event retry sweep works; cancel-at-period-end downgrade (clock-mocked). [manual] real test-mode checkout on preview deploy |
| **M4 Admin** | v1 editor per §3.8 (metadata, steps up/down, §6.1 typed block forms, staging uploads, effective-visibility table, preview-as, publish via RPC — **no notification controls**), `/admin/policy`, revision cloning, cache refresh button | [auto] RPC + trigger guards from M0 re-verified through the UI path; policy edit leaves published output byte-identical; `p_notify_kind` forced NULL; non-admin blocked from every admin action. [manual] author→publish a real playbook end-to-end without SQL |
| **M5 Ship** | Notification pipeline per §3.5 (jobs/deliveries/cron worker/idempotency/unsubscribe) + account toggles + admin notify checkbox; NEW/UPDATED badges; SEO (sitemap + locale alternates, OG from public heroes); deletion runbook doc; **content-ops handoff** (§9: manifest template + fixture promotion); domain + prod deploy | [auto] publish → exactly one delivery per opted-in Pro user; job re-run + worker re-claim = zero duplicate sends; recovery sweep re-queues abandoned leases; unsubscribe flips toggle. [manual] bilingual emails in sandbox inbox; go-live checklist signed |

**Dependency notes**: M0's RPC + published fixtures unblock M1 (public catalog) and M2 (shaping) without M3/M4. M2 tier tests use M0 entitlement fixtures (no Stripe dependency). Notification surface area appears nowhere before M5. **Engineering acceptance uses fixture content only; real playbook content is content-ops (§9), not an engineering gate.**

---

## 9. Launch content plan (content-ops, owned by Yagi — not an engineering gate)

Engineering ships with 2 polished fixture playbooks (placeholder media, clearly labeled). Real content lands via `/admin` using the **content manifest** (`content/MANIFEST.md` template ships in M5): per playbook — source pipeline location, step outline, prompts to publish vs withhold, asset list + rights, EN/KO copy owner, target publish date.

Launch slate (from YAGI's real pipelines):
1. **Character sheet generation** (GPT Image 2 + face-fix pipeline) — showcase
2. **Talking character clip** (image → voice → lipsync) — showcase
3. **Character LoRA training** (Z-Image, 22-min recipe)
4. **Insta-toon pipeline** (4-cut story → panels → publish)
5. **AI short-form clip factory** (script → shots → assembly)
6. **Voice identity setup** (TTS selection + reference recording)

Cadence after launch: 2 new playbooks/month minimum + revision passes when models change (revisions are the retention story).

---

## 10. Risks & mitigations

- **Content leakage** (Pro user copy-pastes prompts publicly): accepted — prompts age fast; the product is *maintained* workflows. Server-side gating prevents scraping, not sharing. Disclosure doctrine §6.
- **SEO vs login-gate tension**: showcase playbooks + public card metadata + fully public landing/pricing with hreflang.
- **Motion cost on low-end devices**: pins ≥1024 only; reduced-motion path; lazy media; subset fonts.
- **Stripe in KR**: reuse YAGI's operating Stripe entity. USD price in v1.
- **Single-author bottleneck**: block templates + revision model + manifest; content calendar is a founder commitment.
- **Framer-parity trap**: §5.3 lists exactly 8 moves; more is scope creep.
- **Leak regressions**: M2 authz sweep + cache sequence + gateway refusal tests live in CI.
- **Stale marketing cache**: tag invalidation + 1h TTL floor + admin refresh button.
- **Framework contract drift**: versions pinned at M0; upgrades deliberate, post-launch.

---

## 11. Execution defaults & stop-gates

**Locked defaults — execution proceeds on these; Yagi may override any of them *before the affected milestone starts*:**
1. **Billing**: $9/**month** subscription (user-stated $9; monthly is the Director's reading of "결제를 시작하게 되면" + recurring notification value). *Gate outcome (2026-08-12): Yagi was notified twice and said 계속 진행 — M3 merged on the monthly default. Switching to one-time remains a bounded pre-launch change (checkout mode + entitlement mapping + pricing copy).*
2. **Repo**: new standalone `D:\dev\playbook`. (Effective at M0.)
3. **KO display face**: Pretendard 900 (visual comp checkpoint inside M1 review).
4. **Showcase count**: 2 of 6 at launch.
5. **Ad sales**: mailto `advertise@yagiworkshop.xyz`; rail below hero only.
6. **Refund wording**: Stripe defaults, no custom policy page in v1. **Stop-gate: confirm alongside #1 at M3.**
7. **Featured selection**: latest 4–6 published, no manual flag.

**True open items (block only their own milestone):**
- **Name + domain** — PLAYBOOK codename is fine through M4; **stop-gate: needed before M5 prod deploy** (domain, OG branding, email sender).
- **Launch content manifest** (§9) — content-ops; blocks *launch*, not engineering acceptance.
- **Supabase cloud project** (discovered at execution, 2026-08-12): the org's free-project limit (2) is used by `twiin` + `yagi-workshop`; creating the `playbook` project requires pausing one of them or upgrading the org — **Yagi's call, needed before M5** (and before real Google-OAuth round-trip testing). Until then, engineering runs on env-gated placeholders + **PGlite-based Postgres tests** (migrations/RPC/trigger acceptance run in CI without Docker; no local Docker/Supabase CLI on this machine).

---

## 12. Cross-validation log (Fable ↔ Codex gpt-5.6-sol)

| Round | Focus | Verdict | Key changes applied |
|---|---|---|---|
| R1 | Product/feature completeness, domain model, gating enforcement | **NOT READY** (15 findings: 5 blockers, 8 major, 2 minor) | Shaper derives server-verified session + eligibility internally; cache contract (`no-store` on all gated routes); private buckets + entitlement gateway with ≤60s signed URLs; immutable revision model + atomic publish; single entitlement source + `stripe_events` ledger + success-route reconciliation; deny-all RLS (zero client data queries); publish-time visibility stamping (non-retroactive policy); notification outbox; zod+CHECK i18n validation + locale publish gate; schema constraint hygiene; deletion request flow; adversarial authz test matrix; B2B CTA; cut CSV export/most-viewed/translate-assist. |
| R2 | R1 regression, design/layout feasibility, i18n routing, admin scope, architecture/milestones | **NOT READY** (3 blockers, 12 major) | Public routes fully locale-prefixed + 308s + hreflang/canonical; publication moved into DB (`publish_revision` RPC + triggers); copy-based asset lifecycle + disclosure doctrine; single `reconcileSubscription` writer; notification jobs unique + provider idempotency keys; landing/pricing = static + tagged revalidation; layout math fixed (rail ≥1440, verified sums); motion ownership contract (native-scroll Lenis, root-portal rail, no pins <1024); observer-driven nav theming (mix-blend dropped); M4 cut to minimum editor; locale precedence chain + OAuth state carry; façade/pure shaper split + two Supabase client factories; milestones re-sequenced (read model + fixtures in M0); acceptance criteria testable + labeled; font ops locked. |
| R3 | Final gate: contradiction sweep, execution readiness, residual risk, scope sanity | **NOT READY** (7 blockers, 4 major, 1 minor) | §11 restructured into **locked execution defaults + per-milestone stop-gates** (no undecided implementation choices remain); asset lifecycle extended to **every** asset (hero/free/pro/workflow) with content-addressed write-once published keys, public bucket only for showcase copies + heroes (public-metadata rule added §3.1); media gateway now authorizes the full chain (current published pointer + playbook eligibility + tier); reconcile redesigned to fetch-time **fencing upsert** (no lock-on-missing-row; interleavings converge) + ledger retry semantics (`processed_at NULL` = retryable) + duplicate-subscription policy; same-playbook pointer enforced by **composite FK** + GUC-gated triggers with an explicit privileged transition whitelist; **§6.1 block content contracts** added (discriminated schemas = renderer props = form fields; nullability + locale-gate clarified); launch content split into **content-ops with manifest** (engineering gates on fixtures only); M0 now ships the full publish RPC (fixtures published through it); pure-vs-façade test split corrected (16-case pure table + eligibility matrix; `archived` is playbook status); notification checkbox removed from M4 + worker claiming/lease/recovery spec added; stale-cache self-heal (TTL floor + admin refresh). Director-judgment keeps (logged): lagged ad rail (user-stated requirement); durable notification schema retained (cheap, M5-scoped). |
| R3b | Closure verification of R3 findings | **10/12 CLOSED; 2 OPEN + 2 new MAJOR** | v1.4 closes all four: publication reshaped into **two-phase prepare→copy→publish** — `prepare_publish` stamps `resolved_visibility` first and derives routing from stamped values into a DB `publish_assets` manifest; `publish_revision` verifies manifest completeness and recomputes routing (edit-after-prepare cannot publish stale); write-once = deny-all storage RLS + `upsert:false` copies + no delete path (GC post-launch). Privileged channel replaced GUC with a dedicated **`publisher` role owning the SECURITY DEFINER RPCs** (`current_user='publisher'` checks — unforgeable from app code) and triggers now also guard **INSERT** under non-draft revisions. Draft preview normalizes effective visibility through the shared resolver (pure shaper always receives non-null visibility). `is_showcase` moved onto the revision — public eligibility and routing can never flip live. |
| R3c | Final stamp: verify the four v1.4 fixes | **READY** (R3-2/R3-5/NEW-1/NEW-2 all CLOSED) | Execution note carried to Opus: manifest-currentness validation must compare the complete canonical asset set — refs, hashes, source keys, AND routing — not a subset. |

**Final status: cross-validation complete. This document is the execution contract for Opus (M0→M5, §8), subject to the stop-gates in §11.**

---

## 13. Prompts pivot — v1.5 surface (founder direction, 2026-08-13)

**Direction (Yagi, verbatim intent)**: the site's form follows **youmind.com/prompts/video** — but prompts-only for now, **two rails**: "Original prompts by YAGI" and community-submitted prompts, and a single model at launch: **Seedance 2.5**. Everything YAGI posts is 100% original (authored + tested in-house) — that is the positioning. Playbooks (§3) stay built but leave the nav until re-activated.

**Measured reference form (YouMind, 2026-08-13 DOM)**: left-rail taxonomy (models / use-case / style / subject), masonry media-first cards (poster + hover video + title + `@author` credit + MODEL chip), weekly-popular rail, daily-drop promise. We reproduce the *form* in our §5 design language; our economics differ (they are 100% free aggregation with credits; we are original + Pro-gated).

### 13.1 Content model — `prompt_items` (atomic; deliberately NOT the revision machinery)
Prompts are single-field items with a moderation workflow; edit-in-place with status flips is honest for them. The playbook revision/trigger discipline continues to protect playbooks only.

```sql
create table prompt_items (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  source text not null check (source in ('yagi','community')),
  author_id uuid references profiles,        -- community: submitter; yagi: null
  author_handle text,                        -- display credit (@handle); community defaults to profile name
  status text not null default 'pending' check (status in ('pending','published','rejected','archived')),
  model text not null default 'seedance-2.5',
  title text not null,                       -- EN or submitter's language
  title_ko text,                             -- YAGI items: required at publish; community: optional
  prompt_text text not null,
  text_visibility visibility not null,       -- yagi default 'pro' (admin may set 'public' teasers); community always 'public'
  media jsonb,                               -- { video?: AssetRef, poster?: AssetRef } — zod-validated; YAGI items require media, community optional
  use_case text[] not null default '{}',
  featured boolean not null default false,
  reject_reason text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
```
- **Gating doctrine unchanged**: `pro` prompt text never enters any payload for non-entitled viewers (server shaping; lock panel + $9 CTA). Community text is public by definition (submission form carries a display-license consent line).
- **Media lifecycle**: uploads → staging; on publish/approve, copy to public keys (posters/videos are card surface = public marketing doctrine §3.1). Same storage interface, small dedicated path; no revisions.
- **Moderation**: community submissions land `pending` (visible to no one but admin + a "pending review" note to the submitter on `/account`); admin approves (may edit slug/tags/handle, set featured) or rejects with reason. Rate limit 3 submissions/day/user; text ≤ 2,000 chars; video ≤ 60s/32MB.

### 13.2 IA (v1.5)
```
/[locale]/prompts              public gallery [static + revalidateTag('prompts')] — cards carry NO prompt text
/[locale]/prompts/[slug]       prompt detail [dynamic, no-store] — text or lock panel per viewer
/prompts/submit                community submission (login)      [dynamic, no-store, noindex]
/api/prompts/copy/[id]         copy endpoint (entitlement-checked; enables copy on gallery cards without embedding text)
/admin/prompts                 moderation queue + YAGI item authoring (admin)
```
- Nav becomes: **Prompts · Pricing** (+ locale toggle, sign in). Library/playbooks denavigated behind `PLAYBOOKS_IN_NAV=false` (routes stay functional; fixtures keep the machinery tested).
- Gallery: two rails — **"ORIGINAL PROMPTS BY YAGI"** (featured-first, lock chips on pro items) and **"FROM THE COMMUNITY"** (@credits) — plus filter chips (use-case) and the single model chip SEEDANCE 2.5. Masonry, hover-autoplay muted, §5 card hover.
- Detail: big media, prompt text/lock, model chip, author credit, use-case tags, copy button, 4 related, submit CTA strip.
- Landing pivots copy to prompts-first (hero line, premise = 100% original manifesto, featured strip = YAGI prompt cards, stats = prompt counts); motion identity (§5) unchanged.
- SEO: published prompt details join the sitemap with locale alternates; gallery indexed; submit/admin noindex.
- Notifications for prompt drops: **backlog** (jobs are revision-bound today; do not extend in v1.5).

### 13.3 Defaults locked (override before M6 merge)
1. Community prompt text is always public (no paywalling other people's prompts).
2. YAGI prompt text defaults `pro`; teasers are deliberate admin choices.
3. Single model chip `SEEDANCE 2.5` (schema keeps `model` text for later).
4. Community media optional (text-only cards get a typographic poster in the design language); YAGI media required.
5. Copy buttons: community/anon = free; YAGI-pro = entitlement-gated via the copy endpoint.

---

## 14. Contests — v1.6 surface (founder direction, 2026-08-13, pre-sleep brief)

**Direction (Yagi)**: add a **Contests tab** — brand-hosted 공모전/film contests. Google login stays zero-friction, but **contest submission requires attaching the entrant's main SNS**. Design completeness pushed via Codex cross-validation ×3; HyperFrames available; images may be generated through Codex's connected Higgsfield.

### 14.1 Model
- v1 is **admin-curated**: brands run contests through the studio pipeline (B2B lane); no brand self-serve. Entries by logged-in users; entry rails are public after moderation (same pattern as prompt moderation).
- `contests`: id, slug unique, status (draft/published/archived), title/summary/prize/rules jsonb {en,ko} (rules markdown), brand_name, brand_url, hero media jsonb (poster required, video optional), starts_at, deadline_at, created/published_at, updated_at. **Phase is derived server-side**: upcoming (< starts) / open (starts ≤ now < deadline) / closed (≥ deadline). Publishing is the founder's act (a prize is a public commitment — the seeded demo contest stays DRAFT).
- `contest_entries`: id, contest_id fk, author_id fk profiles, title, video_url (external — YouTube/Vimeo/TikTok/Instagram/https; film files are links, not uploads, in v1), note ≤300, **sns_url NOT NULL** (entrant's main SNS; http(s), recognized hosts get a platform chip, generic https accepted), status (pending/approved/rejected), reject_reason, placement int null (1/2/3 set by admin post-deadline), timestamps. **unique (contest_id, author_id)** — one entry per user; resubmit while open replaces + resets to pending.
- `profiles.sns_url` added (nullable): submission form prefills from it and writes it back — Google login stays extra-info-free until the first submission asks.
- Entry editing closes at the deadline (server-enforced). Rate limit: ≤10 entry writes/day/user.

### 14.2 Routes & design
```
/[locale]/contests            public listing  [static + tag 'contests']  — open first, then upcoming, then closed
/[locale]/contests/[slug]     detail          [dynamic, no-store]        — published only; draft = admin preview path
/contests/[slug]/submit       entry form      [login-gated, no-store]
/admin/contests               CRUD + moderation queue + placements (registry-dispatcher pattern)
```
- Nav: **Prompts · Contests · Pricing.** Listing carries the B2B CTA ("Run a contest with the studio →" mailto) and a designed empty state (site is live — empty must look intentional).
- §5 language throughout: contest card = poster-led, brand chip + phase chip + D-day label (server-rendered); detail = full-bleed hero, prize set in display type, brand strip, rules (markdown renderer reuse), approved-entries rail (@handle → SNS link), winners strip when placements exist; submit form in the prompts-submit register with the SNS field explained in one honest sentence.
- Deny-all RLS + server actions + zod (URL validation, caps); sweep extensions (anon: draft invisible, pending/rejected entries invisible, submit redirects, sns required).

### 14.3 Quality loop (this run)
Build (Opus) → Director verify (tests/sweep/build/render) → **Codex cross-validation ×3** — R1 code correctness + security, R2 design completeness against §5 (geometry/type-scale data + code), R3 closure — fixes applied between rounds; then production deploy + prod verify.

## 15. Cookies — v1.7 monetization (founder direction, 2026-08-13 morning)

**Direction (Yagi, verbatim intent)**: no monthly subscription for now. A reader opens a prompt page, watches the result clip free, presses **"프롬프트 확인하기"** → signing in is required → the first signup grants **3 free 쿠키(cookies)** → opening one YAGI prompt costs 1 cookie → **1 free cookie per week** ("리셋") → when out, a **$4 one-time purchase buys 5 cookies**. Explicitly NOT a recurring plan. The unit is named 쿠키.

### 15.1 Model (locked defaults — founder may override before merge)
1. **Unlock is permanent per (account, prompt)** — spending a cookie opens that prompt forever; re-reading never charges. (`prompt_unlocks` unique (profile_id, prompt_id); the spend is idempotent.)
2. **Signup grant**: `profiles.cookie_balance` defaults 3 (existing profiles backfilled).
3. **Weekly grant, lazy, non-accumulating**: at wallet-read time, if `now() - cookies_granted_at >= 7 days` → balance +1 and the stamp resets. An absent month yields ONE grant on return, not four.
4. **Community prompts stay free** (§13 doctrine unchanged); admin sees everything; the dormant `pro` tier remains an unlock path in code (unsellable — no checkout reaches it) so the entitlement machinery stays testable.
5. **$4 → 5 cookies** is a one-time purchase behind the injected billing boundary; with no KR-capable gateway connected it renders the designed "결제 준비 중" state (M8 = Paddle-class MoR).
6. All spends transactional: profile row `FOR UPDATE` → idempotency check → lazy weekly grant → balance guard → `cookie_ledger` append + `prompt_unlocks` insert + balance write, one transaction.

### 15.2 Schema (0008 core + 0105 glue, deny-all RLS)
`profiles.cookie_balance int not null default 3 check (>= 0)` + `profiles.cookies_granted_at timestamptz`; `prompt_unlocks` (profile fk, prompt fk, unique pair, created_at); `cookie_ledger` (profile fk, delta ≠ 0, reason in signup/weekly/purchase/unlock, prompt fk null, created_at) — append-only audit; balance column is the fast read, the ledger is the truth for support.

### 15.3 Surface
- Prompt detail lock panel becomes the funnel: anon → "로그인하고 프롬프트 확인하기" (Google → back to the prompt); signed-in with balance → "쿠키 1개로 열기 · 보유 N" (server action); balance 0 → wallet panel ($4/5쿠키 buy button in its designed 준비중 state + the weekly-cookie line). Copy endpoint follows unlocks.
- `/account`: 쿠키 잔액, 열어본 프롬프트, weekly line. `/pricing` rewritten to the cookie table (가입 3 · 주 1 · $4/5). Nav unchanged.
- Sweeps: anon posture unchanged (zero gated bytes); new checks — unlock CTA present for anon, no balance leakage anywhere anonymous.

### Execution log

- **2026-08-13 · M9 Contests merged + live** (`6ee7dc1` + 4 review commits → main `7abfdb0`; KO typography follow-up `63985c7` → `175ce89`) — **the §14 surface is in production.** Deploy order held: 0007/0104 applied to cloud via MCP **before** the push (prod `/contests` would have 500'd on the missing tables); posture verified by SQL (3 tables RLS enabled+forced, zero policies, zero anon/authenticated grants) and `cloud:smoke` now **25/25** (contest tables present; anon REST on all three refused with 401). Director re-ran **922/922 tests** and the anon sweep at **396/396** (+102: draft contests invisible, pending/rejected entries invisible, submit gated, SNS required, judged-lock refusals, phase rails). The §14.3 quality loop ran **five Codex rounds**, not three: **R1 code** (9 findings, all fixed — transactional submit with profile `FOR UPDATE` + ledger-reserve-then-count; `SqlRunner` gains a required `transaction()`; microsecond `updated_at` moderation version guard; alias-cache no-store; placement uniqueness moved into one guarded statement; poster CHECK hardened against jsonb NULL; published-contest sweep fixture; cloud-smoke contest probes; URL normalization through `new URL().href`; datetime blank-vs-invalid split), **R2 design** (10 findings applied with exact geometry/type values — 4:5 poster tier, named contest type slots with 0.85× KO twins, winners-count chip, prize band slot), **R3** (19/20 — residual R1-4: count-then-update deadline-extension race), **R3b** (caught the **null→future deadline laundering bypass** — verdict DO NOT SHIP), fixed by making the judged-contest lock absolute — medals on the board ⇒ deadline **exists AND has passed**, enforced under a shared contest-row `FOR UPDATE` in `updateContest`, `setEntryPlacement` AND `publishContest`, +2 regression tests — **R3c: CLOSED, VERDICT: SHIP**. Ratified: Codex refuted the Director's nav-ghost diagnosis with evidence (subpixel AA; the real defect only at line-height<1 — fixed as the §5.3-3 text-swap geometry) — the review loop works in both directions; the empty-state poster verdict is typographic in the §5 language (Higgsfield imagery deliberately not taken); **the seeded demo contest stays DRAFT** — a prize is a public commitment, publishing is the founder's act via `/admin/contests`. Production verified with real captures + in-page measurement: `/en/contests` + `/ko/contests` render the designed empty state (fixtures are `db:local`-only by design; the first heading capture caught the §5.3-4 clip-path reveal mid-flight — re-verified settled under forced reduced-motion), anon `/admin/contests` 307s to signin. **Post-ship Director render-verify found two KO typography defects, fixed same night** (`63985c7`, 924 tests): `html:lang(ko)` now sets `word-break: keep-all` + `overflow-wrap: break-word` (browsers break Hangul between any syllables — footer.hireCta wrapped mid-word wherever copy shipped without authored breaks; measured clean at 1440 and 375, zero overflowing elements at 375), and the premise stat value was the last raw `text-[clamp]` display slot — Pretendard set "SEEDANCE 2.5" 49px past its grid cell on production (measured); named `.text-stat` with the 0.85× KO twin (44.2px, 52px clearance, EN unchanged). Backlog: contest-drop notifications (jobs stay revision-bound), brand self-serve (B2B lane stays studio-run), M8 billing provider.
- **2026-08-13 · LAUNCHED — https://yagiprompts.com live in production.** Repo pushed to private GitHub `Botanicbox0/yagi-prompts` (browser-created; git push via credential manager); Vercel project `yagi-prompts` imported from Git on team "Yagi Workshop's projects" (Hobby), production deploy from main. Env provisioning hit two real snags, both root-caused: Vercel's env importer **appends** pasted rows instead of filling detected ones (duplicate empty rows silently block the submit — resolved by wiping all rows via DOM and one clean re-import; final inventory verified programmatically: 8 keys, all filled, APP_URL corrected from the imported localhost value to the prod URL — a non-secret edit) and a **BOM** from PowerShell's `-Encoding utf8` made `vercel.json` invalid ("Invalid vercel.json file provided" deploy error; rewritten BOM-less, functions pinned to **icn1 Seoul** for DB colocation, redeploy READY). Deployment protection left at Standard (previews protected, production public). Domain: `yagiprompts.com` bought by Yagi at **Cloudflare Registrar** ($11.25/yr); added to the Vercel project (apex primary, apex→www redirect declined — canonicals are apex), Cloudflare DNS `CNAME @ → e80aab7fd1a3054a.vercel-dns-017.com` **DNS-only** (proxy off per Vercel), SSL issued, domain 200. Supabase Auth: Site URL → `https://yagiprompts.com`, redirect allowlist = `http://localhost:3000/**` + `https://yagiprompts.com/**`. **Full production verification in the founder's browser**: Google login round-trip on yagiprompts.com → `/account` shows the founder signed in (무료/KO) → `/admin/prompts` ("YAGI PROMPTS 관리자") live against the cloud DB with the authoring form ready. Business note: Stripe confirmed unavailable to KR-registered merchants — billing stays honestly disconnected (designed 503 states); M8 = swap the injected `stripe-gateway` boundary to a merchant-of-record (Paddle-class) provider. Remaining: M8 billing provider, Resend domain/key, launch content, session-tier sweeps, www subdomain (optional).
- **2026-08-13 · M7 ship pass merged + cloud go-live verified** (`21b59dd` → main `7c26cc4`; hardening `8d607c6`/`340fa4f` preceded it). Director re-ran 673/673 tests and the hermetic sweep (294/294 **with cloud credentials present** — the `PLAYBOOK_MODE` layering holds). Product renamed **YAGI PROMPTS** across every user-facing surface (repo codename stays playbook; brand test enforces the allowlist). Cloud infra live and verified end-to-end: twiin Supabase **paused** (data intact — storage deletion deliberately left to Yagi, irreversible); project `yagi-prompts` (`nhokkikjkzjalxqsbzuk`, ap-northeast-2); all 10 migrations applied via MCP (0004 needed schema-grant-before-ownership — repo file reordered to match); **advisors caught a real cloud-only hole** — Supabase default privileges exposed the publish RPCs to anon/authenticated over PostgREST `/rpc`; fixed as `0103_glue_supabase_hardening.sql` (+ search_path pins), advisors now clean except the 13 intentional deny-all INFOs. Google OAuth fully live: new GCP project `yagi-prompts` (ID `spatial-iris-505319-p6`), consent screen "YAGI PROMPTS" (external, **published to production**), web client with verified redirect URI; Supabase provider had credentials pasted but the Enable toggle off — flipped + saved; **real login round-trip verified in the founder's browser** (Google chooser → consent → callback → `/account` shows `yagi@yagiworkshop.xyz`). Login debugging surfaced the design fact that viewer identity uses the service-role source whenever auth is configured — an empty `SUPABASE_SERVICE_ROLE_KEY` therefore reads as signed-out and silently skips profile creation in the callback; founder profile seeded via SQL with `is_admin=true`, key then supplied, `/admin/prompts` (YAGI PROMPTS CMS) verified live against the cloud DB. **`npm run cloud:smoke` 21/21, zero skips** (storage staging→signed-URL→cleanup roundtrip, RPC service path, RLS refusals, `google provider enabled: true`). Consent screen shows the supabase.co domain (shared-domain cosmetics — custom domain later). Remaining before public launch: Stripe live/test keys + webhook + real checkout E2E, Resend domain/key, domain purchase (yagiprompts.com $11.25/yr available, checked) + Vercel deploy, launch content via `content/MANIFEST.md`, session-tier HTTP sweeps.
- **2026-08-13 · M6 Prompts pivot merged** (`75bd769` → main `f0d1b1f`) — **the §13 surface is live.** Director re-ran 637/637 tests + sweep **294/294** (+155 checks: rail composition, pro-sentinel absence, pending/rejected invisibility + 404s, copy-endpoint matrix, submit gating, admin moderation blocks, sitemap inclusion) and render-verified with real Chrome: gallery header "EVERY PROMPT / WE ACTUALLY RAN.", both rails (YAGI lock/NEW chips + community @credits incl. the typographic text-only poster), use-case filter chips, submit strip, and the pro detail with big media + §5.5 lock panel + KO subtitle + related rail. Landing hero pivoted: EN "PROMPTS / THAT ACTUALLY / SHIP." · KO "실제로 / 결과가 나온 / 프롬프트." Ratified: 5 community fixtures (3 published/1 pending/1 rejected — brief arithmetic corrected); fixture MP4s are structurally-valid containers without encoded tracks (probe/copier/Content-Type real; hover motion needs a real MP4 via admin — no codec dependency taken); WebM duration unenforced (human moderation covers it; mp4/mov enforced via mvhd); new public route `/api/prompts/media/[ref]` serves **published rows' public-bucket objects only** (posters/clips are public marketing surface — routing them through the entitlement gateway would 401 the og:image crawler); YAGI authoring requires a poster (video optional); submissions require 1–3 use-case chips; middleware wasn't stamping no-store on prompt details (Next default was covering it) — found by sweep, fixed with regression test. Additive migrations 0005/0006/0102 (prompt_items + events type 6 + RLS deny-all). Zero new deps. Backlog: prompt-drop notifications (jobs are revision-bound), likes/weekly-popular rail, image-model categories.
- **2026-08-12 · M5 offline scope merged** (`952e066` → main `c220b13`) — **engineering is now at "flip-the-switches" state.** Director re-ran 478/478 tests, sweep **139/139** (+63 checks: sitemap/robots content, hreflang/canonical/OG emission, unsubscribe refusals), and re-verified the worker's exactly-once posture on the demo DB (rerun = zero new sends, `sent` stays 1). Shipped: full notification pipeline (injected Resend boundary mirroring the Stripe shape; claim-time preference+entitlement re-check inside the `FOR UPDATE SKIP LOCKED` claim predicate; attempts spent at claim; 10-min lease recovery; RFC-8058 List-Unsubscribe; HMAC single-purpose unsubscribe tokens that can only ever write `false`); admin notify checkbox (kind DERIVED from prior publish state, never chosen); bilingual hand-rolled email templates (no gated content in bodies — sentinel-asserted); account toggles (Pro-only); NEW/UPDATED badges (14-day windows, NEW wins, `firstPublishedAt` = debut); sitemap/robots (showcase-only, locale alternates; middleware was 308-ing `/sitemap.xml` into a locale prefix — found by the sweep, fixed with regression test); deletion RUNBOOK; §9 content MANIFEST template with the 6-slate pre-filled; ordered 14-row go-live checklist in `docs/SETUP.md`. Durable local dev DB dir added (`PLAYBOOK_LOCAL_DB_DIR`) so the worker (a second process) shares state with the app. Zero new dependencies. **Remaining = cloud-gated only**: Supabase project (+glue migrations via MCP, service-role key, Google OAuth client, storage driver swap), Stripe live keys + webhook + real test-mode E2E, Resend domain/key, token secrets, domain + Vercel deploy, sitemap submission, launch content (§9), session-tier HTTP sweeps.
- **2026-08-12 · M4 Admin CMS merged** (`0b17443` → main `991b5a3`). Director re-ran 402/402 tests + 76/76 sweep, byte/render-verified via `dev:admin`: editor (all six §6.1 block forms, effective-visibility table `block|kind|default|override|effective`, revision banner, Publish/Prepare controls), policy page with the non-retroactivity banner, and **preview-as tier matrix live: visitor 2 locked → free 1 → pro 0** on the draft fixture; anon `/admin` 307s and anon admin-media 401s; public gateway still refuses draft media (M2 ratification intact). Ratified: publish exposed as full-pipeline AND prepare/commit modes (makes the RPC's edit-after-prepare guard UI-reachable and honestly testable); single guarded dispatcher over a 21-operation registry (auth test enumerates the registry — future ops can't dodge it); composite-FK violations surfaced as the same "not draft" message; JS-free admin forms (GET/POST + `?ok/err` codes, raw DB detail shown on staff screens); clone drops `change_note` + published keys (stale notes can't satisfy the republish gate; drafts can't emit public URLs); **one-draft-per-playbook invariant** (`ensureDraftRevision`); order changes park-to-negative→swap→densify under the non-deferrable unique index; archive = plain `playbooks.status` write (verified against 0003 guards — no new migration). Zero new deps/migrations. Director verification note: an initial "preview 404" scare was my own probe bug (hardcoded 404 label + cold dev-route timeout) — previews verified working; probe discipline logged. Deferred by scope: users tab, CSV, drag-drop, matrix heat view, translate assist, notification controls (M5); admin-tier HTTP sweeps wait on the Supabase stop-gate.
- **2026-08-12 · M3 Monetize merged** (`da23f58` → main `a38d8e3`). Director re-ran 331/331 tests and the extended anon sweep (**76/76**), render-verified `/account` as Pro (real Chrome: "Pro — $9/month · Active · Renews Sep 10 2026 · Manage billing · Request deletion") and byte-verified tier unlocking (Pro detail HTML: 35 gated sentinels visible, 0 lock panels, copy buttons rendered). No Stripe keys on this machine → all Stripe interaction behind `lib/billing/stripe-gateway.ts` (live impl + deterministic fake); webhook signatures tested with the real SDK signer; real test-mode checkout documented as a manual gate in `docs/SETUP.md`. Ratified: fence timestamp stamped **before** the Stripe fetch; fenced upsert + `profiles.plan` mirror as ONE SQL statement (CTE — no read-then-write window); unmapped-customer webhooks answer 202 with `processed_at NULL` for the retry sweep; unknown event types ledgered+stamped; `/billing/upgrade` added (static pricing tree cannot branch on tier) + `/auth/signin` short-circuits for signed-in readers; `cancel_at_period_end` renders as an Active status with a "Cancellation scheduled" chip + "access runs until {date}" (no local clock math); `lib/db/connect.ts` memo moved to `globalThis` (real `next dev` bug: per-route module registries made writes invisible to pages); dev identities (`npm run dev:free|pro|admin`) grant *identity never tier*, triple-fenced, dead code in prod builds. Port-hygiene gotcha documented: `npm start`'s detached `next-server` survives killing the npm wrapper — kill by port (this produced M2's false sweep failure). Deferred: real-key checkout E2E + session-tier HTTP sweeps (Supabase stop-gate).
- **2026-08-12 · M2 Content core merged** (`690b426` → main `99e30f1`). Director re-ran 252/252 tests, re-ran the anon HTTP sweep independently (**57/57** — a first run failed against a stale leftover dev server on :3000, root-caused as environment, not code), and render-verified `/en/p/character-sheet-generation` with real Chrome: sticky step index with lock counts, §5.5 lock panels on all gated kinds, public-only blocks for anon, meta strip, gateway-served hero, ad rail. Ratified: eligibility extracted to pure `decideEligibility` shared by page façade and media gateway; media tokens = HMAC-SHA256 over `{ref,bucket,key,exp,mime,filename}`, ≤60s, ref-bound (`MEDIA_TOKEN_SECRET` env — required before deploy); heroes serve through the gateway under `{revisionId}:hero` (no second route); `public-content` without a CDN falls back to the gateway rather than emitting dead URLs; draft/superseded media refuse **for admins too** (admin media preview = M4 concern); copy buttons Pro-gated on prompt AND params; edge fixtures (draft/superseded/archived/non-showcase) opt-in via `npm run db:local` only; fixture media are real PNGs so streaming + Content-Type are actually tested. Flagged open: `/library` has never rendered in a real browser (no session tier exists yet — component-tested only) and session-tier HTTP sweeps (incl. Pro→free→anon sequence) wait on the Supabase cloud stop-gate; both tracked in `docs/SETUP.md`.
- **2026-08-12 · M1 Landing + pricing merged** (`88c5153` → main `80860ca`). Director re-ran 147/147 tests and render-verified both locales with real headless Chrome (this machine's Browser pane does not composite frames, so scroll-driven behavior was verified via the executor's CDP probe evidence + Director's Chrome captures; feel-level review remains open for Yagi's own eyes). Lighthouse desktop: /en median **100** perf (100/100/100 across categories, all four pages ≥99). Ratified: dark-surface accent `#4C6FFF` (§5.1 note); nav gains an opaque background once scrolled; hero media gets scale+parallax scrub but no second pin (pin budget belongs to "How it reads" per §5.4); featured cards link to `/library` behind `PLAYBOOK_DETAIL_ROUTE_READY=false` until M2 ships the detail route; no ad rail on `/pricing` (§3.6 letter); footer hire CTA is mailto-only until M3 wires the events client; `pg` promoted to prod dependency (catalog SqlRunner driver) + `serverExternalPackages`; local dev/CI data = `npm run db:local` PGlite snapshot built through the real prepare→copy→publish pipeline. M1 also fixed three latent M0 bugs (Tailwind v4 token flattening broke theme inversion; KO display never downscaled; transparent text-stroke) — each with a regression test. Satoshi still pending (manual license-accept).
- **2026-08-12 · M0 Foundation merged** (`3ebc20a` → main `e3f51bb`). Director independently re-ran typecheck + 103/103 vitest + build (route/cache split matches §4 exactly). Notable ratified interpretations beyond the doc edits above: Next pinned to 15.5.23 (not 16 — plan contract), TypeScript 5.9.3; per-route-group root layouts (no shared root — keeps landing/pricing static while `<html lang>` stays per-locale); `profile.locale` consulted at the auth callback (writes the cookie) rather than at the edge; unconditional DELETE guard means playbooks with published history cannot be hard-deleted from app code (archive instead — accepted for v1); `@theme static` so unused-by-M0 tokens survive Tailwind v4 tree-shaking. Flagged: **Satoshi WOFF2 not shipped** (Fontshare requires an interactive license-accept download — 4-step manual recipe in `public/fonts/README.md`; body stack already lists Satoshi first, drop-in). DB acceptance runs on PGlite (core migrations) + `*_glue_*` migrations (RLS force/revokes, `publisher` BYPASSRLS, buckets) documented for cloud apply via MCP — see `docs/SETUP.md` for the manual cloud checklist.
