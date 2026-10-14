# Creator platform verification inventory

Branch `codex/creator-platform`. The owner authorized production application and deployment on 2026-10-15; see the final deployment record for cloud status.

| Claim/control | Functional proof | Visual state/evidence |
|---|---|---|
| Private request and reply | Ownership, strict input, replay, quota tests; browser send/reply | Empty and populated inbox at desktop and 390px |
| Approved format creators only | grant/revoke, denied ordinary user, recipe absent in DTO, accepted template pending | Supplier form and submitted row; admin private recipe/review |
| Honest average and separate QA | real terminal render, self/staff exclusion, one user/template, exclude/edit/restore | Empty average and populated breakdown on template |
| Image-only reward | live paid eligibility, unique post/render, actual usage cost, award budget and immutable ledger | Claim checkboxes, pending state, balance and eligible images |
| Safe redemption | concurrent overspend, replay, owner portrait, stale quote, rollback, failure release and refund reversal | No portrait and insufficient credit states |
| Photo guidance | local model; every analysis state permits submission with consent; reset and offline checks | Eye-level examples, advisory text and Continue with this photo |
| Privacy/security | bounded body, same-origin, auth, direct DB deny-all, client graph + built canary, Gitleaks | No internal error detail, keyboard labels, no horizontal overflow |

Exploratory cases: sending a malformed/unsupported SNS URL; changing a reviewed template before redemption; refunding after credits were consumed; failed image worker retries; English copy at 320px; request submission during a network failure; missing schema with flags off. Test fixtures never invoke paid generation or send email.

Commercial activation remains separate: commercial reward values/expiry/terms, actual image cost and portrait quality, creator contract/payout process, real global payment adapters, subscription allocation, live provider and payment reconciliation. The local pilot supports verified one-time KRW orders only.

## Initial PR baseline (before advisory follow-up)

- `npx tsc --noEmit`: passed.
- `npx vitest run`: **244 files, 2,381 tests passed**, including PostgreSQL ownership, moderation, immutable ledgers, concurrent overspend, failure release, refund reversal, stale offer rejection, video rejection, private-format editor guard, deny-all RLS and admin output access tests.
- `npm run db:local`: fresh migration replay and normal fixture snapshot passed. Separate durable `.pglite/platform-qa` was used for interactive QA; no commercial policy/creator was added to the normal seed.
- `npm run build:local`: production build passed. `security:client` and `security:built`: 74 client entry points passed; public source maps and portrait-prompt canaries absent. An intentional temporary client import of a private prompt was correctly rejected and removed.
- Gitleaks v8.30.1 source scan: no leaks found. Public API hostname and two deliberately synthetic test secrets were the only initial findings; endpoint annotation and test-only values resolve those without suppressing whole directories. This is not a full historical Git audit.
- `npm audit --omit=dev`: 0 reported production dependency vulnerabilities at execution time.
- Browser: private request creation, customer reply, supplier submission, recipe absent from the customer JSON, studio reply reaching the owner, accepted template draft and admin decision history verified through actual local UI. Korean 390px and English 320px had no horizontal overflow. Zero-balance/no-portrait image action is disabled.
- Portrait: selected a repository guide image locally, confirmed three preflight checks plus consent are needed, confirmed all reset on a new file; no generation/provider request was sent. Local fake provider credentials were used only to expose the upload control and were never persisted.
- Ratings: a deliberately failed local fixture received a 2-star customer rating; the page separately displayed a synthetic 4.2 studio QA score. These fixture scores are not product quality claims.
- Production local HTTP: community redirects anonymous to sign-in, API returns 401/private no-store, admin evidence returns 404, global CSP/nosniff are present. Full anonymous sweep result is recorded below.
- `npm run sweep:anon`: **SWEEP PASSED — 958/958 checks**, including the newly added conversation/API/admin-evidence checks.

### Screenshots

- [Customer desktop](screenshots/community-desktop.png), [customer 390px](screenshots/community-mobile.png), [English 320px](screenshots/community-en-320.png)
- [Admin review and decision history](screenshots/admin-community.png)
- [Separate rating signals](screenshots/ratings-separated.png)
- [Portrait desktop](screenshots/portrait-desktop.png), [portrait 390px](screenshots/portrait-mobile.png)

The browser's `networkidle` wait timed out on a template with background requests; the loaded rating DOM and screenshot were then directly inspected. Do not treat that wait as a functional failure or a successful network-idle assertion. Malicious URL and transport/body cases are covered by automated tests; a complete offline/network-interruption browser matrix remains unverified. No real cash payout, SNS API ownership verification, paid generation or cloud migration was attempted.

## Advisory follow-up QA inventory (2026-10-15)

- Actual self-hosted worker/model inference on repository guide photos, without external pixel requests.
- Side-angle and no-face warnings: consent enables Continue with this photo; intercepted POST proves the button submits without provider calls.
- Blocked model and pending analysis: submit remains available.
- Rapid photo replacement: old advice discarded, consent reset.
- 390px Korean and 320px English layout plus visual screenshot inspection.
- Static worker/runtime/model paths stay on the consumer host without locale redirects; workspace hosts stay closed.

Measured advisory results: clear-face guide image was ready; turned-face was angle; blank image was noFace. Side-angle submission reached an intercepted POST (no provider request). Pending/unavailable states kept the button enabled, a new photo reset consent, and rapid replacement retained only the latest advice. Korean 390px and English 320px had no overflow. SDK telemetry was discovered in a network capture, then blocked by an asset-only fetch wrapper plus worker CSP; the final actual inference had zero off-origin requests and zero POSTs. The front-facing guide image produced about 19 degrees of estimated pitch, so the broad advisory pitch threshold was relaxed to 25 degrees; these are not validated biometric measurements.

Final follow-up: `npx tsc --noEmit` and `npx vitest run` passed (246 files / 2,388 tests). Build, anonymous sweep and deployment evidence follow below.

Cloud-baseline rehearsal: applied core migrations through 0041, then 0046 independently, then deferred 0042-0045; all pass. This specifically catches missing cost provenance columns in the real deployment order. Full final test duration 110.76 seconds.

## Production database application (2026-10-15)

Owner-authorized migration core_creator_platform_0046_with_glue_0131 applied successfully in one transaction. All 14 platform tables have ENABLE + FORCE RLS; anon/authenticated direct access denied, service_role CRUD granted. Shared render cost columns exist. No policies, credits, creator approvals or fabricated ratings were seeded.

Supabase security advisor: no new WARN/ERROR finding. The 14 additional INFO entries are expected deny-all tables with no browser policies. Existing warnings remain on guard_brand_prompt/release_brand_production_failure search_path and leaked-password protection configuration; they predate this release. References: [function search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Final local release loop: typecheck passed; Vitest 246 files / 2,388 tests passed; build:local passed; start:local and sweep:anon passed 958/958. Built client privacy scan passed 75 entry points, npm audit --omit=dev reported 0 vulnerabilities. Screenshots: portrait-advisory-desktop.png, portrait-advisory-mobile.png, portrait-advisory-en-320.png. No real generation or bank payout was performed.
