# Admin template registration audit — 2026-09-25

The reported company-domain account has a verified email and `profiles.is_admin=true` in production. An authenticated studio session opens `/admin`, `/admin/prompts`, and `/admin/prompts/new`. The reporting person's own OAuth session was not available. The user clarified that finding the registration action was likely the issue; no claim is made that their exact failure was reproduced.

## Changes

- A visible new-template action and template-management link on the admin home; consistent new-template naming on the list.
- Registration steps, required use-case/poster guidance, and an explicit immediate-publication notice on the new form. No draft mode is implied.
- Fixed the missing outcome banner: refused saves returned to an apparently blank form even though the URL carried the rejection. Regression tests failed before the fix.
- Preserve signing-route rejection reasons for size, type, and expired/insufficient session, rather than suggesting every error could be retried. MIME fallback only for missing browser MIME, using already-allowed extensions; server limits and role checks are unchanged.
- Both languages use the existing dictionaries. No price, rendering flag, billing, legal, or database schema change.

## Verification

- Local administrator fixture: image and video templates each passed file selection, creation/publication, and return to the populated template list. No production template was published for testing.
- Browser: admin home/list/new at 1440 px and 390 px, ko/en (12 page states), no horizontal overflow or page errors; create actions visible in the first viewport on both home and list.
- Browser: unsupported HEIC and oversize 49 MiB MP4 show different actionable errors.
- Production read-only: company account admin and verified status; authenticated administrator can open the registration page.
- Full release loop: `npx tsc --noEmit` passed; `npx vitest run --maxWorkers=4` passed 178 files / 1,944 tests; `npm run build:local` and `npm run start:local` passed; `npm run sweep:anon`: SWEEP PASSED, 664/664. The first unbounded test run was interrupted for excessive memory use; no assertion failure was reported from it. The bounded full run completed.

Screenshots: [desktop entry](admin-template-registration-20260925/home-ko-desktop.png), [mobile entry](admin-template-registration-20260925/home-ko-mobile.png), [mobile registration](admin-template-registration-20260925/new-ko-mobile.png).

## Limits / follow-up

A rejected form still requires re-entry; retaining drafts is separate work. Real production storage PUT and the reporting person's own session were not exercised. Local inline storage and signing-route tests are separate evidence, not a production large-file-upload claim.

A template currently resolves one medium and engine. An image-model character sheet or three-panel sheet can be configured as an image template; automatically feeding its result into a video stage needs an explicit multi-stage workflow and is not implemented by this change. Existing identity/provider validation stays intact.

