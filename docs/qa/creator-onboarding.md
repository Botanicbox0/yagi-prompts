# Creator onboarding — final Codex review

2026-10-19 · `codex/creator-onboarding` · base `5756f71`.

Fable (`claude-fable-5-1`) authored [the plan](../CREATOR-ONBOARDING-PLAN.md). Opus (`claude-opus-5-5`) implemented it and repaired Codex's findings. Both model identities were confirmed in official Claude CLI run metadata. Codex independently inspected the source, ran the final release checks and exercised the browser flows below. No production changes were made.

## Delivered behavior

Program → application → studio review → creator workspace → private format submission → feedback → revision → template draft. Accepted, published and purchasable states remain distinct. The workspace shows the creator's own live paid one-time order counts and recorded creator shares. The approved split remains creator 80% / TWINGS 20% of distributable margin. Recorded shares are explicitly **not completed transfers**.

## Final verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed |
| `npx vitest run` | **270 files / 2,563 tests passed**, 125.20 s |
| `npm run build:local` | Passed |
| `npm run security:built` | Passed: 80 client entry points, built assets checked |
| `npm run start:local` → `npm run sweep:anon` | **993/993 passed**, default gates closed |
| `git diff --check` | Passed |
| Impeccable manual detector, new creator routes/components | Exit 0, no findings |

The initial implementation also passed a production build and **1,015/1,015** anonymous checks with both creator gates enabled. After review fixes, the final open-state verification was the real-browser pass below; the final production build/sweep used closed defaults.

The pre-existing campaign-risk test failure was a clock mismatch: outbox availability used the real database clock while its job used the fixture clock. Only the fixture was corrected; production risk behavior is unchanged.

## Independent browser evidence

Chrome on Windows; fresh isolated PGlite database; synthetic `TEST ONLY` identities and orders; no cloud credentials. The final fixture was recreated after an earlier overlapping fixture reset. These results come from the fresh run.

| Flow | Observed result |
|---|---|
| New applicant | Empty workspace; native server-action POST with JavaScript disabled reached submitted state |
| Invalid grouped field | Empty media selection focused the first checkbox and announced its error |
| Network failure | Error displayed, answers retained; retry succeeded |
| Revoked creator | Reapply link; pending/declined reapplication visible; no format submission before approval |
| Admin review | Approval stored contract version and granted role; decline stored applicant-visible note |
| Format rejection | Admin note appeared in creator workspace; internal reason did not |
| Revision | Title/type/example prefilled, recipe empty; revised format POST succeeded as a new submission |
| Format acceptance | Admin created template draft; creator saw accepted + template pending |
| Recipe boundary | Recipe canaries absent from creator HTML before and after submission/acceptance |
| No-JS format form | POST method, disabled controls and JavaScript-required notice |
| Earnings | Synthetic: 2 paid orders, 1 pending cost, 1 recorded share, ₩6,240; no customer/payment details |
| Responsive | KO 1440/390 px, EN 320 px; no document horizontal overflow; table scroll contained |
| Browser errors | No page errors during final flows |

Screenshots contain synthetic data and the Next development indicator:

- [Program KO desktop](creator-onboarding/program-ko-desktop.png) · [KO mobile](creator-onboarding/program-ko-mobile.png) · [EN 320 px](creator-onboarding/program-en-mobile.png)
- [Workspace desktop](creator-onboarding/workspace-ko-desktop.png) · [mobile](creator-onboarding/workspace-ko-mobile.png)
- [Admin review](creator-onboarding/admin-review-desktop.png) · [Declined reapplication](creator-onboarding/reapplication-declined.png)

## Review findings resolved

1. Native GET fallback could expose form values. Application now has a real server-action POST; format submission has a POST-only, disabled-until-hydrated fallback.
2. Grouped-checkbox errors did not recover focus. The first control is now focused and references the alert.
3. Revoked creators' reapplications were hidden. Pending/declined cards now remain visible with read-only records.
4. `created_at` was called an approval date. DTO/copy now say registration date.
5. The new module's server-only marker had been removed for a test. It was restored with appropriate test mocks; the client privacy scan remains.

Regressions cover onboarding, access, server actions, form markup, workspace states, route/cache/RLS/sitemap behavior and the browser flows above.

## Rollout boundaries

| Configuration | Behavior |
|---|---|
| Defaults | Program 404, public applications closed |
| `TWINGS_FORMAT_CREATORS=on` only | Existing invited suppliers retain workspace submission; no public intake |
| Both supplier and `TWINGS_CREATOR_APPLICATIONS=on`, migrations ready | Public application flow available |
| Both flags on, new migration absent | Static program may appear, but applications fail closed; legacy submission/review works; notes/revisions refused |

**Cloud application required:** `0051_core_creator_onboarding.sql` + `0138_glue_creator_onboarding.sql`. Applications use FORCE RLS with no anon/authenticated table grants. Identity and gates are server-derived; creator DTOs are explicit allowlists.

Before intake opens, the owner must settle the creator agreement, rights/licensing terms and application-data privacy/retention wording, then approve migration and intake activation. Actual transfers, payout scheduling/KYC/tax, payment opening, pricing and public template publication remain separate operations. This PR performs none of them.

## Reproduce authenticated local QA

Use the helper's header instructions. Seed: `node --conditions=react-server --import tsx scripts/creator-onboarding-local-qa.ts seed`. Serve: `node --import tsx scripts/creator-onboarding-local-qa.ts serve <role>`. Its environment whitelist forwards no cloud credentials.

Use **http://localhost:3108**, matching Next's request origin on this Windows host. Production same-origin protection is unchanged. Stop the single QA server before reseeding/building; never let two processes write the same PGlite directory. Synthetic fixtures can be aged locally to test the 24-hour quota.

Raw final logs/assertions: `.pglite/creator-onboarding-qa/reviewer/` (gitignored).
