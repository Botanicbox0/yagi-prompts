# TWINGS 전 화면 감사와 수정 (2026-09-23)

Branch `codex/opus-surface-audit`, base `8f4e06e` (PR #22). This covers three hosts:

- twings.app (consumer and marketing)
- brand.twings.app (brand workspace)
- admin.twings.app (admin)

Phase 1 was a read-only audit that confirmed defects with repro tests. Phase 2 fixed them after coordinator approval.

What this pass did not touch:

- DB schema, RLS, migrations
- Terms (`lib/legal/documents.ts`), prices, PG
- `RENDER_PIPELINE_PUBLIC` (stays `false`)
- Production data
- Outbound sends (mail, Slack)

Client names, handles and metrics are not in any document or fixture.

## Result summary

- **Phase 1:** 6 P1s, 18 P2s, about 25 groups of P3, 5 hypotheses, 8 policy questions.
- **Phase 2:** all P1s and P2s fixed, plus the routine P3 items. Q1 is on hold until 대표 decides.
- **Verification** (final code, `8f48c29`):

| Check | Result |
|---|---|
| `tsc` | 0 errors |
| vitest | 161 files, 1,761 tests passed |
| `build:local` | succeeded |
| `start:local` + `sweep:anon` | SWEEP PASSED 643/643 |
| `smoke-workspace-hosts` | 87/87 |

## Fixed

### P1

| ID | Problem | Fix | Regression test |
|---|---|---|---|
| P1-1 | The admin form was labelled Korea time but campaign deadlines were saved as UTC, 9 hours late | New `lib/campaigns/dates.ts`. Input is read as +09:00; the edit form, public cards/detail/apply/my campaigns and emails all show KST date and time. Contest helpers still use UTC | `tests/campaigns/dates.test.ts`, `tests/campaigns/card-kst.test.tsx` |
| P1-2 | Brand support, comments and "전용 템플릿 의뢰" requests never reached a studio queue | Read-only `lib/brands/workspace/inbox.ts` (DB `is_admin` only). "답장 대기" list on `/admin/brand-workspace` and a count on the `/admin` dashboard. Still no outbound notification | `tests/admin/studio-inbox.test.tsx` |
| P1-3 | The `(app)` group had no 404 or error page, so users hit Next's English 404 and a mixed-language joke error screen | New `app/(app)/not-found.tsx` (language-aware, same panel as marketing) and `error.tsx` (small copy set, both dictionaries kept out of the client bundle). `global-error.tsx` now has short ko/en copy. Sweep marker `data-app-not-found` | `tests/routes/app-boundaries.test.tsx`, sweep |
| P1-4 | The "월 $9 subscription" Stripe entry was still exposed | `/billing/{upgrade,success,cancelled}` 308 to `/{locale}/pricing`. `/api/billing/checkout` returns 410 `subscription_retired`. Callback default → `/{locale}/video`. Stripe gateway, webhook, portal and Toss one-time flows unchanged | `tests/billing/retired-subscription.test.ts`, sweep |
| P1-5 | A failed OAuth sign-in on the consumer host lost the return path | The failure URL carries a re-validated `next`, and the notice offers a retry link. `//evil`, `/\evil`, encoded separators and tab injection are still rejected | `tests/auth/return-path.test.ts`, `tests/ui/notice.test.tsx` |
| P1-6 | admin.twings.app had no sign-out, so a non-admin was stuck | Sign-out form in the admin shell. A non-admin on the admin host gets **307 → `/admin/no-access` (403)**, with sign-out and no admin data. The consumer host and anonymous visitors still get 404. A redirect was used instead of a notice in the layout because the layout does not stop the page's server data from rendering | `tests/admin/admin-signout.test.tsx` |

### P2 and routine P3

- **Author of comments and support messages (P2-4):** decided by the trusted server entry point. The brand API passes `entry:'client'` and the admin console passes `'studio'`. It never comes from the request body.
  - An admin who is also a member writes as `brand` from the brand API and as `studio` from the admin console.
  - A non-member admin in the brand API writes as `studio`, as before.
  - Domain-only staff are refused on both paths.
  - Test: `tests/brands/author-entry.test.ts`.
- **Invitations (P2-1/2/3):**
  - After accepting, the user lands on that brand (or that campaign).
  - Accepting as an existing member counts as success.
  - Expired, revoked or invalid links show "invalid link". The wrong account shows a message plus a sign-out button, and says to reopen the link.
  - The service refuses a campaign-only invite for a campaign not shared with the client (`not_shared`). Brand-wide invites still work before publication. The admin page shows a note instead of the form.
  - A guest who already received an invite to a hidden campaign sees "공유 준비 중", not "create a workspace".
  - Tests: `tests/brands/invitation-{journey,form}.test.tsx`.
- **Team page:** campaign-only invites show the campaign name (or "공유 전 캠페인"). Owner emails are hidden in the invitation history too, the same rule as the member list.
- **Brand studio (P2-5, Q5):**
  - The identity link goes to `/auth/signin?next=/identity/…`. It is absolute only on brand.twings.app.
  - The engine-name placeholder ("SEEDANCE 2.5") is replaced by "미리보기 준비 중".
  - The "TWINGS STUDIO" label comes from the dictionary.
  - The result link keeps the brand id.
- **Brand P3:**
  - Dates, file sizes and a PDF icon now follow the reader's locale.
  - The "확인했습니다" checkbox is required only for approval.
  - Tab nav label fixed and `#review` hash navigation works.
  - Filter group has `role="group"`.
  - Cancelling an upload shows no error, and `rate_limited` has its own message.
  - The no-JS language form keeps `organizationId`.
  - `brand/error.tsx` no longer bundles the dictionaries.
  - "다음 할 일" (`.bw-tab-next`) moves above the tabs so it is visible.
- **Admin error wording, confirmations and return paths (P2-6/7/8):**
  - Brand conflict, not-active, consent-required and not-shared errors have their own messages. The contest "출품자" sentence is gone.
  - A confirmation checkbox guards publishing a report, completing or cancelling a campaign (terminal), opening recruiting (mail goes out), announcing a template, and marking a payout.
  - Status changes offer only the valid next statuses as buttons.
  - Saving a prompt, playbook or payout returns to the same page.
  - Test: `tests/admin/admin-outcomes.test.tsx`.
- **Admin P3:** raw values (medium, render status, platform, statuses, "views", mime/sha256) now come from the dictionary. User and render ids are shortened. The duplicate language switcher is removed.
- **Invite link origin (H1):** `https://brand.twings.app` only when issued from admin.twings.app. Local and preview hosts use their own origin.
- **Consumer journeys (P2-9 to P2-13, P2-18):**
  - "내 계정" link in the app header, and a footer link to `/auth/signin?next=/account`.
  - Result-page feedback failures show an error.
  - The campaign CTA goes to `/{locale}/t/{slug}#make`.
  - The identity pages keep `next`.
  - An expired Toss order shows "결제되지 않았습니다 · 다시 시작". The return page remembers the order id.
  - One KRW format (`9,900원` / `₩9,900`).
- **Copy:**
  - The unsubscribe screen names the right mail type ("새 템플릿 알림" / "캠페인 알림").
  - The payout step and FAQ a5 now say "each campaign's holding period" instead of a blanket 7 days.
  - FAQ a3 now carries every terms §5.3 element: own face only, one portrait group per account, BytePlus automatic review, camera verification when needed, 24-hour report review, deletion.
  - While generation is closed, campaign and template pages no longer promise instant generation.
  - The brand request receipt text appears only when the mail was actually sent. "1영업일" is removed because nothing enforces it.
  - Localized per language: email footer company name and address, account-deletion and footer mailto, OG and escrow alt text, receipt email.
- **Consumer P3:**
  - Important notes raised from `opacity-45/50` to 70%.
  - The progress bar has an accessible name.
  - The chooser back link no longer points at signed-in-only pages.
  - Nav sign-in returns to the current page.
  - The studio blocks double submit (`components/twings/submit-guard.ts`).
- **Unused code:** deleted only HIGH-confidence items: 3 modules, the pricing components, about 20 exports and guards, 124 unused leaf dictionary keys per language, and 3 CSS selectors. The removed list and evidence are in the commit bodies of `b75140a`, `6f92506`, `f24dcd8` and `e88d3ed`.
- **Documentation:**
  - `docs/WORKSPACE-HOST-ROUTING.md`: brand.twings.app, the brands→brand 308, and the current allowlists.
  - `docs/CONTENT-SLOTS.md`: the HERO_REEL slot does not reach the current screen.
  - `docs/TEMPLATES-IA.md` §6: deletion status.

## On hold and remaining decisions

- **Q1. Should campaign-only guests see shared contracts and budget?** Currently they can. The readiness review (`MORPHIC-SHARING-READINESS.md:24`) says "no contract access", but no policy document decides it. Unchanged until 대표 answers.
- **Existing production campaign deadlines:** entered before this pass, they may already be stored 9 hours late. No bulk migration. An operator should open each campaign's edit screen, check the value against the intended KST time, and save it again.
- **Q6.** The "활용 방식" field, grid and case studies (AGENTS §8): not built, pending approved values and case data.
- **Q8.** Email or Slack alerts for support messages: deferred. For now the admin "답장 대기" list is the only channel.
- **Admin confirmation checkboxes are enforced in the browser only.** Adding server enforcement would change the existing operation contracts.
- **An owner cannot revoke a pending invite.** There is no existing owner-level revoke path, and none was added.
- **Sign-out then reopen invitation:** the invitation token lives in the URL fragment and is lost on sign-out, so sign-out does not return to the invitation. The copy tells the user to reopen the link.
- **Sign-out from the brand workspace on local or preview hosts** lands on the consumer home. Low impact, unchanged.
- **Cleanup deferred (MEDIUM, tests still reference them):**
  - `submitPrompt`, `submitEntry`, `contestMetadata*`
  - `startCookiePackPurchase`
  - `PromptHeader` / `PromptBody` / `SubmitStrip`, `authorizePromptCopy`
  - `components/contests/rails.tsx`
- **Needs owner confirmation:**
  - `HeroMedia` / `ReelPoster`
  - 16 recent `brandWorkspace.*` keys
  - `portrait.remaining*` / `retryAction`
  - `public/brand/preview.html`
- **The ko `cookies.*` copy still exists.** Its remaining keys are read by `promptLabels`, so they could not be deleted in this pass.

## Checks not performed

- Live Google/Kakao OAuth (consumer, admin, brand), including cancelling consent and in-app browsers.
- Screenshots (desktop, 390/320 mobile, KO/EN) and visual review. Browser tools were unavailable in this environment. The coordinator's checklist is in the working notes (`tmp/opus-browser-checklist.md`).
- Vercel preview hosts, Supabase signed URLs, real Toss/Stripe payment windows.
- The `/admin/no-access` page has no sweep marker because it needs a signed-in non-admin session.
- The return page's `sessionStorage` retention has no automated test because there is no DOM test environment.
