# TWINGS quality review — Opus 5.5, Phase 1 (2026-09-23)

Baseline: `10f321b` (PR #18), branch `codex/opus-quality-pass`. This review builds on the coordinator's current-turn baseline: tsc, vitest 133 files/1,461 tests, db:local, build:local and sweep:anon 637/637 all passed. Phase 1 changed no code. Phase 2 implemented F1–F4; see [Phase 2 — implemented](#phase-2--implemented-2026-09-23) at the end.

**Polish verdict: ship after fixes.** Security boundaries are strong: tenant checks in `lib/brands/workspace/service.ts:42-63`, the HTTPS-only link schema at `schemas.ts:5-16`, middleware that keeps deep links, and XSS-safe rendering already covered by a test. The consumer generation surfaces also handle the closed rollout honestly. Most remaining gaps are in **role and permission states** and **form feedback** in the brand workspace, the surface clients use most now. There are no P0 findings.

## Method and limits

- **What I read:** the code for the brand layout/nav, home, new project, project detail, members, settings, studio, support, upload, action/managed forms, contracts and tabs CSS; the admin layout, brand queue and contract/visibility actions; auth chooser, middleware and routing; the render result page, portrait studio and the closed state of the template page; the relevant `messages/ko.ts` keys; and existing brand tests.
- **Screenshots:** I looked at 7 screenshots in `docs/evidence/{workspace-design,workspace-controls,brand-production,brand-service-distinction}`. They are **historical**. Some predate the current layout: for example, `workspace-design/brand-ko-desktop.png` shows the language control in the header, but the current `app/(brand)/layout.tsx:58-66` puts it in the sidebar footer. Visual claims below are marked **[visual, historical]** and need a live check.
- **Not run:** no browser, no live screenshots, no OAuth, payment or generation.
- **Not reviewed in depth:** Toss/Stripe checkout internals, admin prompt/contest editors, marketing landing sections, SEO/JSON-LD, identity verify.

## Findings, ranked

### P1 — Viewer and project-scoped members hit create flows they cannot use (code-supported)

- **Loop.** Trigger: a user whose only membership is `viewer`, in a workspace with no campaigns.
  - `app/(brand)/brand/page.tsx:44-51` shows the empty state with a "캠페인 의뢰" CTA. The header CTA at line 17 correctly checks role; this one does not.
  - The CTA goes to `/brand/projects/new`. That page filters out viewer orgs (`projects/new/page.tsx:8-10`), says "워크스페이스를 만들어 주세요", and links "워크스페이스 만들기" back to `/brand` (lines 20-26).
  - `/brand` does not show the create form, because an org exists (line 20). The user goes round in a loop.
  - `ServiceGuide` on the studio page (`service-guide.tsx:18`) also links every role to `/brand/projects/new`.
- **Team nav shows an error to legitimate members.** `navigation.tsx:6` shows all 5 items to every role. For an editor or viewer, `members/page.tsx:19-21` finds no owner org and shows `<p role="alert">이 워크스페이스에 접근할 수 없습니다.</p>` (line 40). A legitimate member sees what reads as an access error.
- **Project-scoped invitees.** These are users with `brand_project_members` rows but no org membership, via the "이 캠페인만 · 조회 전용" invite scope. They get `organizations: []` (`service.ts:138-142`), so:
  - Settings shows the denied note.
  - `/brand` shows an empty "내 워크스페이스" section (`page.tsx:55-72`).
  - Studio inquiry offers to **create a new workspace** (`studio-inquiry.tsx:59-63`).

### P2 — Invalid-field feedback does not reach the field (code-supported)

- `ActionForm` calls `field.focus()` (`action-form.tsx:128-131`) while `busy` is still true. The `<fieldset disabled={… busy …}>` at line 167 is still disabled, so focus fails and the submit button is disabled too. Focus drops to `<body>`.
- The service returns only `path[0]` (`service.ts:68`). Two consequences:
  - `criteria.maxFollowers` (min > max, `schemas.ts:31`) maps to `"criteria"`. No element has that name, so nothing is marked. The fields are also inside a collapsed `<details>` (`projects/new/page.tsx:100`).
  - `referenceLinks.N.url` maps to nothing.
  - In both cases the user reads "표시된 입력 항목을 확인해 주세요" with nothing marked.
- Content review: "수정 요청" requires a comment on the server (`schemas.ts:49`), but the client does not say so up front (`project-detail.tsx:260-272`). The user only finds out after a failed round trip.

### P2 — One-click disclosure and destructive actions (code-supported)

- **Admin → client disclosure, no confirmation:**
  - "고객에게 공유" contract PDF (`contracts.tsx:61-79`).
  - "고객에게 공개" campaign visibility (`admin/brand-workspace/[id]/page.tsx:66`).
  - Once shared, the client can download the PDF, so an accidental share cannot really be undone.
- **Member removal, no confirmation:**
  - Owner-side "접근 권한 삭제" (`members/page.tsx:54-64`).
  - Admin revoke (`organizations/[id]/page.tsx:64`).
  - Recovery takes a new manual invite link.
- **Styling and errors in `ManagedForm`:**
  - Every button uses `bw-primary` (`managed-form.tsx:95`), so share, revoke and save all look the same.
  - Every failure shows "연결 상태를 확인하고…" (line 98-101), including stale-revision `conflict` and `invalid`. That sends the operator off in the wrong direction.

### P2 — State and accessibility gaps (code-supported unless marked)

- **Brand error boundary retry.** `app/(brand)/brand/error.tsx:18` calls only `reset()`. For errors thrown by server components, Next 15 re-renders without re-fetching unless you also call `router.refresh()`, so "다시 시도" likely does nothing. Verify in a browser.
- **Support drawer** (`support.tsx`):
  - While the first fetch is in flight, it shows the empty-state invitation "궁금한 점이 있으면 편하게 남겨주세요" (lines 134-136) instead of a loading state.
  - After a successful send, a failed refresh shows the generic *save* error (lines 76-80).
  - The `<dialog>` has no accessible name (line 98). `StudioInquiry` does it correctly with `aria-labelledby`.
- **No skip link in the brand workspace** (`app/(brand)/layout.tsx`). Before `#main` there are the sidebar links, the language control and sign-out. Marketing has one (`components/nav/site-nav.tsx:106`).
- **Brand login "← 돌아가기" loops.** On the brand chooser it points to `next` (`auth/choose/page.tsx:165`), usually `/brand`. Middleware sends signed-out users back to the chooser (`middleware.ts:125-131`), so it reloads the same page.

### P3 — Hierarchy on the brand home ([visual, historical] plus code order)

- The order in `CampaignList` (`campaign-list.tsx:27-34`) is: featured campaign → "확인할 제작물" attention → grid.
  - `ServiceGuide`, an explanatory marketing-style block, sits above all of it on every visit (`brand/page.tsx:19`).
  - On 390/320 px (`brand-service-distinction/campaign-ko-390.png`, `workspace-controls/campaign-ko-320.png`), the actionable item is about 1.5 screens down.
  - The featured campaign then repeats in the grid.
- The detail page's "다음 할 일" block is always hidden by `.bw-tab-next{display:none}` (`workspace.css:757`), so `project-detail.tsx:109-112` is dead UI.

## Recommended bounded fixes

Order is by value. Each fix stays inside the brand workspace, admin brand-workspace, and auth chooser. None changes policy, prices, legal text, RLS or schema.

### F1 — Role-aware brand navigation and empty states (P1)

**Change:**
- Pass roles into `WorkspaceNavigation`:
  - "팀" only for owners.
  - Settings, studio and library only when the user has at least one org membership.
- Brand home empty state:
  - Viewer-only: read-only copy, no create CTA.
  - Project-scoped only: hide the empty "내 워크스페이스" section.
- `/brand/projects/new`:
  - For users who have an org but no write access, show a read-only explanation and a back link, not "워크스페이스 만들기".
- `ServiceGuide`: take a `canCreate` flag.
- `StudioInquiry`: do not offer to create an org when the user has project access but no org.
- New ko/en keys go in `messages/*.ts`. The Director should confirm the wording.

**Acceptance:**
- A vitest renders the brand home and new-project page with viewer-only and project-scoped fixtures. Neither contains `href="/brand/projects/new"` or the `organization.create` form.
- The nav render for an editor has no `/brand/members`. For an owner it does.
- The members page is never reached through nav by a non-owner. A direct visit shows a neutral note, not `role="alert"`.
- `tests/i18n/dictionary.test.ts` passes, plus the full §3 loop.

**Risk:** low. UI only; server permissions are unchanged.

### F2 — Field-accurate form errors (P2)

**Change:**
- `service.ts:68` returns the full dotted path, e.g. `criteria.maxFollowers`, `referenceLinks.1.url`.
- `ActionForm` maps it to the element (strip `criteria.`; take the Nth `referenceUrl`), opens any ancestor `<details>`, and focuses **after** the fieldset re-enables (e.g. store the target and focus in an effect after `busy` becomes false).
- The decision form marks the comment as required when "수정 요청" is selected.

**Acceptance:**
- A unit test on the pure mapping function: `criteria.maxFollowers` → `maxFollowers`; `referenceLinks.1.url` → the 2nd `referenceUrl`.
- The service test asserts the full path.
- The existing brand workspace/API tests that assert `field` are updated and green.

**Risk:** low. Check for callers that compare `field` to a top-level name.

### F3 — Confirmation before disclosure and removal, plus honest admin errors (P2)

**Change:**
- Add an optional `confirm` prop (text) to `ManagedForm` and `ActionForm`. It shows a two-step inline confirmation: the first click reveals the confirm text and a "확인" button. Avoid `window.confirm`, for testability and localization.
- Use it for contract share/unshare, campaign publish-to-client, brand-side member revoke, and admin revoke access/invite.
- Add a `tone="secondary|danger"` prop so these buttons are not styled `bw-primary`.
- Map `ManagedForm` errors by `result.code`: conflict → `b.conflict`, invalid → `b.invalid`.

**Acceptance:**
- A component test shows that the first submit of a confirm form sends no request, and the second does.
- The rendered HTML for contract share includes the confirmation copy key.
- A conflict response renders `b.conflict`.

**Risk:** low–medium. It adds one step for operators. Keep idempotency keys unchanged.

### F4 — Workspace state and a11y fixes (P2)

**Change:**
- `brand/error.tsx`: `startTransition(() => { router.refresh(); reset(); })`.
- `SupportDrawer`:
  - Separate a `loading` state; show `b.loading` until the first fetch resolves.
  - `aria-labelledby` on the dialog.
  - Show a distinct message when loading fails rather than the save error.
- Brand layout: add a skip link to `#main`, reusing the marketing pattern.
- Brand auth chooser: hide the back link when `next` is a protected brand path (or point it to the public campaigns page).

**Acceptance:**
- Rendered markup of the drawer before the first fetch has no `supportEmpty` text. The dialog has `aria-labelledby`.
- Brand layout HTML contains `href="#main"` as the first focusable element.
- The chooser with `next=/brand` has no `data-auth-back` pointing to `/brand`. Update `tests/routes/brand-auth-experience.test.tsx` accordingly.
- Sweep still passes.

**Risk:** low.

### F5 (optional) — Put action first on the brand home (P3)

**Change:**
- Render the attention block before the featured campaign.
- Exclude the featured campaign from the grid, or drop the featured card when attention exists.
- When the user has ≥1 campaign, collapse `ServiceGuide` into one line: the `t.other` link plus a `<details>` for scope/terms. Keep `data-brand-service`.
- Remove the dead `.bw-tab-next` markup, or show it above the tabs.

**Acceptance:**
- In `tests/brands/home-ui.test.tsx`, `data-home-attention` appears before `data-featured-campaign`.
- The service guide full text renders only in the empty state.
- Confirm with live 390/1440 screenshots.

**Risk:** the service-distinction block came from a deliberate PR. Get the Director's OK on collapsing it.

## Backlog (not in scope)

- **Mobile workspace nav** scrolls horizontally with no hint of more items; at 320 px the third item is cut to its icon. Settings/team are likely off-screen. [visual, historical: `workspace-controls/campaign-ko-320.png`]
- **Floating support button** overlaps card media at 390/320 px. [visual, historical: `brand-production/brand-studio-mobile-ko.png`]
- **Low-contrast text:** meaningful text at `opacity-45/50` on white fails AA for small text (e.g. "not charged" and share expiry on `renders/[id]/page.tsx:127,139`, consent at `auth/choose/page.tsx:200`). 108 low-opacity uses across 42 files need triage.
- **`global-error.tsx`** has hard-coded mixed ko/en copy with a joking tone, outside the dictionaries.
- **`CampaignList` status filter group** has `aria-label` without `role="group"` (line 37). The project tabs nav is labelled "캠페인 이름" (`project-tabs.tsx:41`).
- **Hash tabs** start on performance, then switch after hydration, so `#review` links flash and don't scroll (`project-tabs.tsx:20-29`).
- **Upload cancel** reports "첨부하지 못했습니다" (`upload.tsx:110-134`). `rate_limited` shows the "check your connection" error.
- **`/renders/[id]` progressbar** has no accessible name (line 99).
- **An `is_admin` user posting support from the brand host** is recorded as `studio` (`service.ts:633-638`).
- **Admin managed-campaign create** hard-codes `productionMode=creator` (`admin/brand-workspace/page.tsx:34`).
- **Brand studio identity link** always points to `https://twings.app` (`studio/page.tsx:83`), which is wrong on local/preview.
- **`brand/error.tsx`** is a client component that imports both full dictionaries into the client bundle.

## Deferred and business choices (not decided here)

- Wording of new role/empty-state strings (F1) and confirmation copy (F3): Director review, per AGENTS §5/§9. *Update: the coordinator authorized routine UI copy for Phase 2, so this was finalized in the pass.*
- Whether the service guide stays full-size for returning users (F5).
- Unchanged and out of scope: per-use pricing, subscription, `RENDER_PIPELINE_PUBLIC`, portrait rollout, live payment, legal text and new templates.

---

## Phase 2 — implemented (2026-09-23)

Scope: F1–F4 as accepted. F5 was not done. Nothing in this phase touches server authorization, RLS, schema, prices, legal text, flags or dependencies. It adds ordinary UI copy to `messages/{ko,en}.ts` (`brandWorkspace.skipToContent`, `access.*`, `decisionForm.*`, `confirm.*`, `errors.*`, `managed.support{Loading,LoadFailed,SentNotLoaded}`).

### F1 — Role-aware navigation and states

- **`components/brand-workspace/access.ts` (new):** derives presentation flags from the memberships the server already scoped: `hasOrganization`, `canRequest`, `isOwner`, `projectScopedOnly`, `fresh`. It is presentation only; every page and API still authorizes on its own.
- **Nav (`navigation.tsx`, `app/(brand)/layout.tsx`):**
  - Team: owners only.
  - Settings: any workspace member (non-owners read it).
  - Studio: hidden only for campaign-only invitees.
  - Campaigns and library: always shown.
  - When access is unknown (signed-out invitation landing), all items show, as before.
- **Home (`brand/page.tsx`):**
  - Fresh account: creation form unchanged.
  - Owner/editor with no campaigns: request CTA unchanged.
  - Viewer-only: read-only empty state (`data-brand-empty="read-only"`) with no CTA.
  - The "내 워크스페이스" footer renders only when the account has an org. The service-guide link to Studio is hidden for campaign-only invitees.
- **New brief (`projects/new/page.tsx`):**
  - An account with no workspace creates one in place (`redirectTo=/brand/projects/new`), removing the old bounce through `/brand`.
  - A viewer-only account gets a neutral explanation and a back link.
  - Editors and owners keep the form.
- **Direct visits:**
  - `members` for non-owners and `settings` for campaign-only invitees now show neutral notes, not `role="alert"`.
  - Settings shows non-owners the read-only form with an owner-only note.
  - The studio service guide hides its "brief" link for viewer-only accounts.
- ~~Studio for campaign-only invitees on direct visit: left as is.~~ **Wrong, and fixed after coordinator review** (see "Coordinator review fixes" below).

### F2 — Field-accurate errors

- **`lib/brands/workspace/service.ts`:** `mutation` returns the full dotted zod path (e.g. `criteria.maxFollowers`, `referenceLinks.1.url`). I checked every consumer first: `components/brand-workspace/action-form.tsx` is the only reader of this `field`. `lib/brands/service.ts`, campaigns and contests have their own untouched shapes. Top-level names are unchanged (`title`, `comment`).
- **`components/brand-workspace/form-errors.ts` (new, pure):**
  - Maps a path to the flat input, including the Nth `referenceUrl`/`referenceNote`, and rejects unsafe names.
  - Opens every enclosing `<details>`.
  - `createFieldFocus()` focuses only once the control is not inside a disabled fieldset, then forgets it.
- **`ActionForm`:**
  - Marks the mapped field and queues focus. An effect on `[busy, notice]` flushes the queue after the commit that re-enables the fieldset.
  - Adds an in-flight ref against double submit.
  - Maps `rate_limited` to its own message.
- **`components/brand-workspace/decision-fields.tsx` (new):** "수정 요청" makes the comment `required`, relabels it "수정할 내용 (필수)" and adds a hint. Approval keeps it optional. The server rule (`schemas.ts:49`) is unchanged.

### F3 — Confirmation before disclosure and removal

- **`components/brand-workspace/confirm-step.tsx` (new):**
  - First submit only opens an inline, labelled group.
  - Only the confirm button, identified by `data-confirm-step` on the native `submitter`, sends. Enter in a field or the original button never does.
  - Cancel and Escape send nothing and return focus to the original button.
  - `tone` maps to existing classes plus new `.bw-danger`/`.bw-danger-solid` in `workspace.css`.
- **Applied to:**
  - Contract share (secondary) and unshare (danger): `contracts.tsx`.
  - Campaign publish (primary) and hide (danger): admin `[id]/page.tsx`.
  - Brand-side member removal: `members/page.tsx`.
  - Admin access and invitation revoke: `organizations/[id]/page.tsx`.
- **`ManagedForm`:**
  - In-flight ref.
  - Idempotency keys unchanged.
  - Honest error mapping via `managedErrorMessage`: `staleReview` → conflict, `invalid` → validation, `forbidden`/`notFound` or a bodiless 404 → "not available / refresh". Only real network failures keep the connection message. The server remains authoritative.

### F4 — State and accessibility fixes

- **`support.tsx`:**
  - The dialog is named via `aria-labelledby`.
  - Load state is `idle | loading | ready | failed`. The empty invitation shows only after a successful empty load. Load failure has its own alert. A sent message whose reload fails says it was sent.
  - Rate-limit gets its own message.
- **Brand layout:** a skip link to `#main` is now the first body element (`.bw-skip-link`).
- **Auth chooser:** the "back" link is omitted when `next` is a gated brand path (except `/brand/invite`) or an admin path on the admin host, because those redirect straight back to the chooser. Consumer back links are unchanged.
- **Retry (`brand/error.tsx`):** I checked the installed Next **15.5.23** source. `node_modules/next/dist/client/components/error-boundary.js:97-100` shows `reset` only calls `setState({ error: null })` and re-renders the existing payload; it does not fetch from the server. Retry now runs `startTransition(() => { router.refresh(); reset(); })`. This is justified by that source; I have **not** reproduced a server-render failure in a browser.

### Tests (current turn)

- **New:**
  - `tests/brands/quality-pass-client.test.tsx`: path mapping, nth reference row, `<details>` reveal, focus timing (no focus while the fieldset is disabled; exactly one focus after the commit), rate-limit, confirm consent marker, no send on first submit, one send on a double confirm, cancel focus return, Escape, admin error mapping, error-boundary refresh + reset.
  - `tests/brands/quality-pass-ui.test.tsx`: real pages rendered for fresh, viewer, editor, owner and project-scoped accounts; nav visibility; owner-only direct routes; support drawer states; conditional reason.
  - `tests/brands/quality-pass-service.test.ts`: `criteria.maxFollowers`, `referenceLinks.1.url`, and unchanged top-level `title`/`comment`.
- **Updated:**
  - `tests/routes/brand-auth-experience.test.tsx`: back-link loop cases.
  - `tests/brands/action-form-navigation.test.tsx`: its React mock now supplies `useId`.
- **Results:**
  - `npx vitest run`: **136 files, 1,496 tests passed** (before a type-only edit to one new test file; that file re-ran 14/14 green afterwards).
  - `npx tsc --noEmit`: no errors in the changed or new files. The one remaining error is `tmp/prepare-qa.ts(14,104)` in the untracked coordinator `tmp/`, which this pass did not touch.
- **Not run:** build/start/sweep/browser (the coordinator owns :3000). The sweep's brand-chooser markers (`data-brand-auth`, showcase, provider, legal) are unchanged.

### Short audit of Phase 1 gaps

No high-risk finding:

- **Billing boundary:** sound.
  - `RENDER_PIPELINE_PUBLIC` is checked at order creation and confirm (`lib/billing/toss-service.ts:82,161`).
  - Orders are owner-scoped (`user_id=$2`).
  - Amount and price are rechecked (lines 179-187), and the provider balance too (225).
  - The fake gateway only runs off Vercel in `PLAYBOOK_MODE=local` or test (`toss-gateway.ts:155`).
- **Identity verify:** `next` is normalized same-origin (`lib/identity/links.ts:12`). The liveness page language is fixed to `en` because the provider supports only zh/en/zh-Hant (`lib/ark/assets.ts:421`). Korean copy around that hand-off is a possible later polish.
- **Admin prompt actions:** `prompt.archive` is reversible (`lib/admin/prompt-operations.ts:405-415`); no confirmation needed.
- **SEO signals, low:** `DISALLOWED_PATHS` (`lib/seo/sitemap.ts:140`) predates `/brand/settings`, `/brand/library` and `/brand/studio`. They are auth-gated, noindex and disallowed on the brand host anyway, so this is only crawler courtesy on the consumer host.

### Coordinator review fixes

The coordinator's cross-check (local project-only snapshot; `docs/evidence/opus-quality/*.png`) found two concrete holes in the Phase 2 work above. Both are now fixed.

1. **F2 reference index.**
   - *Problem:* `ActionForm` deliberately drops blank reference rows before posting, so the server's `referenceLinks.N` means the Nth **non-empty** row. My mapping used the DOM index directly. With row 0 blank and row 1 `http://…` (a valid URL for the browser, refused by the HTTPS rule), the wrong input was highlighted.
   - *Fix:*
     - `ActionForm` now records a submitted-index → DOM-row list while filtering.
     - `locateField(form, path, rows)` translates through it. An index it cannot place marks nothing rather than the wrong input.
     - Filtering and URL rules are unchanged.
2. **F1 studio direct route.**
   - *Problem:* hiding the nav link did not fix `/brand/studio` itself. A campaign-only account still saw "Request a template", onboarding copy, and an `organization.create` form.
   - *Fix, `StudioInquiry`:* it now renders nothing unless the account has a writable org, or is brand-new and the page passes `allowSetup` (only when `access.fresh`).
   - *Fix, studio page:*
     - Campaign-only accounts get an honest note (`access.studioSharedOnly`) and a back link, with no onboarding and no production or portrait queries.
     - When the selected org's role is viewer, the empty state explains that owners and editors request templates (`access.studioViewer*`), instead of pointing to a button the viewer doesn't have.
   - Fresh-account creation and owner/editor requests are preserved. Server permissions are unchanged.

Regressions added:
- `quality-pass-client.test.tsx`:
  - Blank / `http://` / blank rows: the posted payload keeps only the non-empty row, and the 2nd DOM input is marked.
  - Note mapping to the correct row.
  - An index it cannot place marks nothing.
- `quality-pass-ui.test.tsx`:
  - The real `BrandStudio` page for project-only, viewer, fresh, editor and owner accounts.
  - `StudioInquiry` rendered directly, including no creation without `allowSetup`.

Final focused results for this round:
- `quality-pass-client`, `quality-pass-ui` and `i18n/dictionary`: **3 files, 47 tests passed**.
- `npx tsc --noEmit`: **clean**.
- I did not re-run the full suite or the browser/build gates; the coordinator owns those.

### Remaining (not done)

- F5 and the Phase 1 backlog are untouched: mobile nav overflow, FAB overlap, low-opacity contrast, `global-error.tsx` copy, hash-tab flash, upload-cancel message.
- No live-browser verification of any Phase 2 change. The coordinator should check:
  - Viewer, editor and owner homes.
  - The confirm group at 390/1440.
  - Support drawer loading.
  - Skip link on focus.
  - The invalid follower-range brief (opens the section and focuses max followers).

## Coordinator final verification — 2026-09-23

Review and implementation were performed by Windows Claude Code **2.1.280**, actual response model **`claude-opus-5-5`**, session `0f2b1e35-c128-4a73-90db-4ad797eb99d3`. Codex provided scope, reproduced two missed boundary conditions, requested a second Opus patch, and verified the final result.

- Final `npx tsc --noEmit`: passed.
- Final `npx vitest run`: **136 files / 1,504 tests passed**.
- `npm run build:local`, `npm run start:local`: passed.
- `npm run sweep:anon`: **SWEEP PASSED — 637/637**.
- `git diff --check`: passed.

Actual local browser checks (synthetic fixtures only):
- Viewer without campaigns: no create CTA loop; direct new-project route explains read-only access. Team nav is absent.
- Project-only invitation: campaign and content library remain available; no empty organization section. Direct studio route offers a truthful access note and return link, with no workspace-creation form. English mobile checked at 390px.
- Admin campaign visibility and contract sharing: first click opens confirmation. Cancel/Escape close it and restore focus to the original button. Contract confirmation fits 390px without horizontal overflow. No disclosure request was submitted.
- Owner project form: blank first reference and invalid second URL focus the **second** reference input after the fieldset re-enables. Invalid follower range inside a collapsed details element expands it, marks `maxFollowers`, and focuses it.
- Evidence: `docs/evidence/opus-quality/*.png` (local fixture content, no credentials).

Editor/fresh-user/other role permutations and support loading/error timing are covered by automated component/service tests rather than a complete browser run. Server-error retry is supported by installed Next source plus regression tests; a real transient server failure was not injected. No actual payment, generation, customer invitation or message was sent. No DB migration or runtime flag change is needed. This review improves concrete gaps; it is not a claim that every surface is now industry-leading or a comprehensive security audit.
